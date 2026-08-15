package com.rork.quizroyaleshowdown.data

import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

private const val TAG = "AuthViewModel"

/** How often an active guest checks in so its temporary id does not lapse. */
private const val HEARTBEAT_INTERVAL_MS = 4L * 60L * 1000L

/** Credentials handed to the match socket. Exactly one is ever populated. */
data class MatchCredentials(val token: String?, val guestId: String?)

data class AuthUiState(
    val identity: Identity = Identity.Unknown,
    val busy: Boolean = false,
    /** Server-side validation errors, keyed by form field. */
    val fieldErrors: Map<String, String> = emptyMap(),
    val error: String? = null,
    val notice: String? = null,
    /** True once we know who the player is, so the UI can stop showing a spinner. */
    val bootstrapped: Boolean = false
)

/**
 * Owns the player's identity for the whole app: bootstraps a guest session on
 * first run, exchanges credentials for a session token on register/login, keeps
 * the guest id alive while the app is in use, and exposes the stats the home
 * screen and leaderboards render.
 */
class AuthViewModel(app: Application) : AndroidViewModel(app) {

    private val prefs = PlayerPrefs(app)
    private val api = AuthApi()

    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

    private var heartbeatJob: Job? = null

    val identity: Identity get() = _uiState.value.identity

    /** Credentials for the match socket: a token wins over a guest id. */
    val matchCredentials: MatchCredentials
        get() {
            val token = prefs.sessionToken
            return if (token != null) {
                MatchCredentials(token = token, guestId = null)
            } else {
                MatchCredentials(token = null, guestId = prefs.guestId)
            }
        }

    init {
        bootstrap()
    }

    /**
     * Restores a registered session if the stored token still works, otherwise
     * falls back to a guest identity so the player can always play.
     */
    private fun bootstrap() {
        viewModelScope.launch {
            val token = prefs.sessionToken
            if (token != null) {
                val profile = api.me(token)
                if (profile != null) {
                    prefs.playerName = profile.username
                    _uiState.update {
                        it.copy(
                            identity = Identity.Registered(profile),
                            bootstrapped = true
                        )
                    }
                    return@launch
                }
                // Token no longer valid — drop it and continue as a guest.
                Log.d(TAG, "Stored session rejected; falling back to guest")
                prefs.sessionToken = null
            }
            ensureGuestSession()
            _uiState.update { it.copy(bootstrapped = true) }
        }
    }

    /** Issues or renews the temporary guest id and starts the keep-alive loop. */
    private suspend fun ensureGuestSession() {
        val session = api.guestSession(prefs.guestId, prefs.playerName)
        if (session == null) {
            _uiState.update {
                it.copy(error = "Can't reach the arena. Check your connection.")
            }
            return
        }
        prefs.guestId = session.guestId
        _uiState.update { it.copy(identity = Identity.Guest(session), error = null) }
        startHeartbeat()
    }

    /**
     * Keeps an active guest's id alive. If the id has already lapsed the server
     * says so and we transparently take a fresh one, which is exactly the
     * recycle behaviour a temporary identity should have.
     */
    private fun startHeartbeat() {
        heartbeatJob?.cancel()
        heartbeatJob = viewModelScope.launch {
            while (isActive) {
                delay(HEARTBEAT_INTERVAL_MS)
                val current = _uiState.value.identity
                if (current !is Identity.Guest) return@launch

                val refreshed = api.guestHeartbeat(current.session.guestId)
                if (refreshed != null) {
                    _uiState.update { it.copy(identity = Identity.Guest(refreshed)) }
                } else {
                    Log.d(TAG, "Guest id lapsed; requesting a new one")
                    prefs.guestId = null
                    ensureGuestSession()
                    return@launch
                }
            }
        }
    }

    // ------------------------------------------------------------- registration

    /**
     * Creates a registered account. When [transferGuestStats] is set and the
     * player is currently a guest, the server folds that session's stats into the
     * new account and retires the guest id in the same atomic step.
     */
    fun register(
        username: String,
        email: String,
        password: String,
        transferGuestStats: Boolean,
        onSuccess: () -> Unit
    ) {
        if (_uiState.value.busy) return
        _uiState.update { it.copy(busy = true, fieldErrors = emptyMap(), error = null, notice = null) }

        viewModelScope.launch {
            val guestId = (_uiState.value.identity as? Identity.Guest)?.session?.guestId
            when (val outcome = api.register(username, email, password, guestId, transferGuestStats)) {
                is AuthOutcome.Ok -> {
                    adoptSession(outcome.value)
                    _uiState.update {
                        it.copy(
                            busy = false,
                            notice = if (outcome.value.transferredFromGuest) {
                                "Account created — your guest run came with you."
                            } else {
                                "Account created. Welcome to the arena."
                            }
                        )
                    }
                    onSuccess()
                }

                is AuthOutcome.Invalid -> _uiState.update {
                    it.copy(busy = false, fieldErrors = outcome.fields, error = outcome.message)
                }

                is AuthOutcome.Failed -> _uiState.update {
                    it.copy(busy = false, error = outcome.message)
                }
            }
        }
    }

    fun login(identifier: String, password: String, onSuccess: () -> Unit) {
        if (_uiState.value.busy) return
        _uiState.update { it.copy(busy = true, fieldErrors = emptyMap(), error = null, notice = null) }

        viewModelScope.launch {
            when (val outcome = api.login(identifier, password)) {
                is AuthOutcome.Ok -> {
                    adoptSession(outcome.value)
                    _uiState.update {
                        it.copy(busy = false, notice = "Welcome back, ${outcome.value.profile.username}.")
                    }
                    onSuccess()
                }

                is AuthOutcome.Invalid -> _uiState.update {
                    it.copy(busy = false, fieldErrors = outcome.fields, error = outcome.message)
                }

                is AuthOutcome.Failed -> _uiState.update {
                    it.copy(busy = false, error = outcome.message)
                }
            }
        }
    }

    /** Stores the token, adopts the profile and stops any guest keep-alive. */
    private fun adoptSession(result: AuthResult) {
        heartbeatJob?.cancel()
        heartbeatJob = null
        prefs.sessionToken = result.token
        prefs.playerName = result.profile.username
        // The guest id is now owned by the server (retired if transferred).
        prefs.guestId = null
        _uiState.update { it.copy(identity = Identity.Registered(result.profile)) }
    }

    fun logout() {
        val token = prefs.sessionToken
        prefs.sessionToken = null
        _uiState.update { it.copy(identity = Identity.Unknown, notice = "Signed out.") }

        viewModelScope.launch {
            if (token != null) api.logout(token)
            ensureGuestSession()
        }
    }

    // ------------------------------------------------------------------ friends

    fun addFriend(username: String) {
        val token = prefs.sessionToken ?: return
        if (_uiState.value.busy) return
        _uiState.update { it.copy(busy = true, error = null, notice = null) }

        viewModelScope.launch {
            when (val outcome = api.addFriend(token, username.trim())) {
                is AuthOutcome.Ok -> _uiState.update {
                    it.copy(
                        busy = false,
                        identity = Identity.Registered(outcome.value),
                        notice = "Added $username."
                    )
                }

                is AuthOutcome.Invalid -> _uiState.update {
                    it.copy(busy = false, error = outcome.message ?: "Could not add that player.")
                }

                is AuthOutcome.Failed -> _uiState.update {
                    it.copy(busy = false, error = outcome.message)
                }
            }
        }
    }

    fun removeFriend(userId: String, username: String) {
        val token = prefs.sessionToken ?: return
        if (_uiState.value.busy) return
        _uiState.update { it.copy(busy = true, error = null, notice = null) }

        viewModelScope.launch {
            when (val outcome = api.removeFriend(token, userId)) {
                is AuthOutcome.Ok -> _uiState.update {
                    it.copy(
                        busy = false,
                        identity = Identity.Registered(outcome.value),
                        notice = "Removed $username."
                    )
                }

                is AuthOutcome.Invalid -> _uiState.update {
                    it.copy(busy = false, error = outcome.message ?: "Could not remove that friend.")
                }

                is AuthOutcome.Failed -> _uiState.update {
                    it.copy(busy = false, error = outcome.message)
                }
            }
        }
    }

    // ------------------------------------------------------------------ profile

    /** Re-reads stats from the server. Called after a match settles. */
    fun refresh() {
        viewModelScope.launch {
            when (val current = _uiState.value.identity) {
                is Identity.Registered -> {
                    val token = prefs.sessionToken ?: return@launch
                    api.me(token)?.let { profile ->
                        _uiState.update { it.copy(identity = Identity.Registered(profile)) }
                    }
                }

                is Identity.Guest -> {
                    val refreshed = api.guestMe(current.session.guestId)
                    if (refreshed != null) {
                        _uiState.update { it.copy(identity = Identity.Guest(refreshed)) }
                    } else {
                        // The id lapsed while we were away — take a fresh one.
                        prefs.guestId = null
                        ensureGuestSession()
                    }
                }

                Identity.Unknown -> Unit
            }
        }
    }

    /** Renames a guest. Registered players are identified by their username. */
    fun renameGuest(name: String) {
        val trimmed = name.trim().take(16)
        if (trimmed.isBlank()) return
        prefs.playerName = trimmed

        val current = _uiState.value.identity
        if (current !is Identity.Guest) return
        _uiState.update {
            it.copy(identity = Identity.Guest(current.session.copy(displayName = trimmed)))
        }
        viewModelScope.launch {
            api.guestSession(current.session.guestId, trimmed)?.let { session ->
                prefs.guestId = session.guestId
                _uiState.update { it.copy(identity = Identity.Guest(session)) }
            }
        }
    }

    fun clearMessages() {
        _uiState.update { it.copy(error = null, notice = null, fieldErrors = emptyMap()) }
    }

    override fun onCleared() {
        super.onCleared()
        heartbeatJob?.cancel()
        api.shutdown()
    }
}
