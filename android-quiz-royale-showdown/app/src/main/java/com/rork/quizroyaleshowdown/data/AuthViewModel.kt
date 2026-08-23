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

/** Mirrors the server's guest TTL so the countdown bar can show a full scale. */
const val GUEST_TTL_MS = 30L * 60L * 1000L

/** How often the keep-alive loop wakes to consider checking in. */
private const val HEARTBEAT_TICK_MS = 30L * 1000L

/**
 * A check-in only happens if the player did something since the last one. This
 * is what makes the 30-minute limit a real *idle* timeout: an app left open on
 * the table stops extending the session, so the warning can actually appear.
 */
private const val ACTIVITY_WINDOW_MS = 90L * 1000L

/** How often a registered player reports presence to their friends. */
private const val PRESENCE_TICK_MS = 45L * 1000L

/** Remaining time at which the guest warning appears, and turns urgent. */
private const val EXPIRY_WARNING_MS = 5L * 60L * 1000L
private const val EXPIRY_CRITICAL_MS = 60L * 1000L

/** Credentials handed to the match socket. Exactly one identity is ever populated. */
data class MatchCredentials(val token: String?, val guestId: String?, val guestSecret: String?)

/** How close a guest session is to lapsing. */
enum class ExpiryLevel { SAFE, WARNING, CRITICAL, LAPSED }

data class GuestExpiryState(
    val expiresAt: Long,
    val remainingMs: Long,
    val level: ExpiryLevel
) {
    /** 1f at a full window, 0f at expiry — drives the drain bar. */
    val fraction: Float get() = (remainingMs.toFloat() / GUEST_TTL_MS).coerceIn(0f, 1f)

    val mmss: String
        get() {
            val totalSeconds = (remainingMs / 1000L).coerceAtLeast(0L)
            return "%d:%02d".format(totalSeconds / 60L, totalSeconds % 60L)
        }
}

data class AuthUiState(
    val identity: Identity = Identity.Unknown,
    val busy: Boolean = false,
    /** Server-side validation errors, keyed by form field. */
    val fieldErrors: Map<String, String> = emptyMap(),
    val error: String? = null,
    val notice: String? = null,
    /** True once we know who the player is, so the UI can stop showing a spinner. */
    val bootstrapped: Boolean = false,
    /** Friends with live presence. Kept beside the profile so pings can refresh it. */
    val friends: List<Friend> = emptyList()
)

/**
 * Owns the player's identity for the whole app: bootstraps a guest session on
 * first run, exchanges credentials for a session token on register/login, keeps
 * the guest id alive *while the player is actually active*, publishes how long a
 * guest session has left, and reports presence so friends can see each other.
 */
class AuthViewModel(app: Application) : AndroidViewModel(app) {

    private val prefs = PlayerPrefs(app)
    private val api = AuthApi()

    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

    /** Null unless the player is a guest. Ticks about once a second. */
    private val _guestExpiry = MutableStateFlow<GuestExpiryState?>(null)
    val guestExpiry: StateFlow<GuestExpiryState?> = _guestExpiry.asStateFlow()

    private var heartbeatJob: Job? = null
    private var presenceJob: Job? = null
    private var tickerJob: Job? = null

    private var foreground = false
    private var lastActivityAt = System.currentTimeMillis()
    /** Guards against re-issuing a guest id repeatedly once one has lapsed. */
    private var handlingLapse = false
    /** Set while a match is on screen so foreground presence keeps polling. */
    private var inMatchMode: String? = null

    val identity: Identity get() = _uiState.value.identity

    /** Credentials for the match socket: a token wins over a guest id. */
    val matchCredentials: MatchCredentials
        get() {
            val token = prefs.sessionToken
            return if (token != null) {
                MatchCredentials(token = token, guestId = null, guestSecret = null)
            } else {
                MatchCredentials(token = null, guestId = prefs.guestId, guestSecret = prefs.guestSecret)
            }
        }

    init {
        bootstrap()
    }

    // ---------------------------------------------------------------- lifecycle

    /**
     * Called when the app comes to the foreground. Loops only run while the app
     * is actually visible — a backgrounded app must not hold a guest id alive,
     * nor keep telling friends it is online.
     */
    fun onForeground() {
        if (foreground) return
        foreground = true
        noteActivity()
        startTicker()
        startHeartbeat()
        startPresence()
        // The session may have lapsed while we were away, so re-read it.
        if (_uiState.value.bootstrapped) refresh()
    }

    fun onBackground() {
        foreground = false
        heartbeatJob?.cancel()
        presenceJob?.cancel()
        tickerJob?.cancel()
        heartbeatJob = null
        presenceJob = null
        tickerJob = null
    }

    /** Any real interaction. Wired to a root-level pointer listener. */
    fun noteActivity() {
        lastActivityAt = System.currentTimeMillis()
    }

    /** Tracks match-screen visibility; the match room owns IN_MATCH presence. */
    fun setInMatch(mode: GameMode?) {
        inMatchMode = mode?.name
        noteActivity()
        // Push immediately rather than waiting for the next tick — entering and
        // leaving a match are exactly the moments friends care about.
        val token = prefs.sessionToken ?: return
        viewModelScope.launch {
            api.presencePing(token, inMatchMode)?.let { friends ->
                _uiState.update { it.copy(friends = friends) }
            }
        }
    }

    // ---------------------------------------------------------------- bootstrap

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
                            friends = profile.friends,
                            bootstrapped = true
                        )
                    }
                    startPresence()
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
        val session = api.guestSession(prefs.guestId, prefs.guestSecret, prefs.playerName)
        if (session == null) {
            _uiState.update {
                it.copy(error = "Can't reach the arena. Check your connection.")
            }
            return
        }
        val adopted = rememberGuestSession(session)
        _uiState.update {
            it.copy(identity = Identity.Guest(adopted), friends = emptyList(), error = null)
        }
        publishExpiry(adopted.expiresAt)
        // Loops belong to the foreground only; starting them here unconditionally
        // would let a backgrounded app keep the session alive and issue requests.
        if (foreground) {
            startTicker()
            startHeartbeat()
        }
    }

    // -------------------------------------------------------------- keep-alive

    /**
     * Slides the guest expiry forward, but only when the player has actually
     * done something recently. Without that condition an open app would extend
     * the session forever and the idle limit would be meaningless.
     */
    private fun startHeartbeat() {
        heartbeatJob?.cancel()
        heartbeatJob = viewModelScope.launch {
            while (isActive) {
                delay(HEARTBEAT_TICK_MS)
                if (!foreground) return@launch

                val current = _uiState.value.identity
                if (current !is Identity.Guest) return@launch

                val idleFor = System.currentTimeMillis() - lastActivityAt
                if (idleFor > ACTIVITY_WINDOW_MS) continue

                val secret = current.session.guestSecret ?: prefs.guestSecret
                if (secret == null) {
                    handleLapse()
                    return@launch
                }
                val refreshed = api.guestHeartbeat(current.session.guestId, secret)
                if (refreshed != null) {
                    val adopted = rememberGuestSession(refreshed, secret)
                    _uiState.update { it.copy(identity = Identity.Guest(adopted)) }
                    publishExpiry(adopted.expiresAt)
                } else {
                    Log.d(TAG, "Guest id lapsed during heartbeat")
                    handleLapse()
                    return@launch
                }
            }
        }
    }

    /**
     * Explicit "keep me in" from the expiry warning. Counts as activity and
     * checks in straight away so the countdown visibly resets.
     */
    fun extendGuestSession() {
        noteActivity()
        val current = _uiState.value.identity as? Identity.Guest ?: return
        viewModelScope.launch {
            val secret = current.session.guestSecret ?: prefs.guestSecret
            if (secret == null) {
                handleLapse()
                return@launch
            }
            val refreshed = api.guestHeartbeat(current.session.guestId, secret)
            if (refreshed != null) {
                val adopted = rememberGuestSession(refreshed, secret)
                _uiState.update {
                    it.copy(identity = Identity.Guest(adopted), notice = "Session extended.")
                }
                publishExpiry(adopted.expiresAt)
            } else {
                handleLapse()
            }
        }
    }

    /** Publishes a fresh countdown roughly once a second while a guest is active. */
    private fun startTicker() {
        if (!foreground) return
        tickerJob?.cancel()
        tickerJob = viewModelScope.launch {
            while (isActive) {
                if (!foreground) return@launch
                val current = _uiState.value.identity
                if (current !is Identity.Guest) {
                    _guestExpiry.value = null
                    delay(2_000L)
                    continue
                }

                publishExpiry(current.session.expiresAt)
                if (_guestExpiry.value?.level == ExpiryLevel.LAPSED) handleLapse()
                delay(1_000L)
            }
        }
    }

    private fun publishExpiry(expiresAt: Long) {
        val remaining = (expiresAt - System.currentTimeMillis()).coerceAtLeast(0L)
        _guestExpiry.value = GuestExpiryState(
            expiresAt = expiresAt,
            remainingMs = remaining,
            level = when {
                remaining <= 0L -> ExpiryLevel.LAPSED
                remaining <= EXPIRY_CRITICAL_MS -> ExpiryLevel.CRITICAL
                remaining <= EXPIRY_WARNING_MS -> ExpiryLevel.WARNING
                else -> ExpiryLevel.SAFE
            }
        )
    }

    /**
     * The guest id is gone. Take a fresh one and say so plainly — silently
     * swapping identities would make a player's stats appear to vanish.
     */
    private fun handleLapse() {
        if (handlingLapse) return
        handlingLapse = true

        viewModelScope.launch {
            prefs.guestId = null
            prefs.guestSecret = null
            ensureGuestSession()
            _uiState.update {
                it.copy(notice = "Guest session expired. You're on a fresh guest id — register to keep your run next time.")
            }
            handlingLapse = false
        }
    }

    // ----------------------------------------------------------------- presence

    /** Tells the server the player is here, and refreshes friends' presence. */
    private fun startPresence() {
        if (!foreground) return
        presenceJob?.cancel()
        presenceJob = viewModelScope.launch {
            while (isActive) {
                val token = prefs.sessionToken
                if (token == null) return@launch

                // A match screen keeps the presence poll alive even when no taps
                // occur; the match room is the only authoritative IN_MATCH writer.
                val idleFor = System.currentTimeMillis() - lastActivityAt
                if (inMatchMode != null || idleFor <= ACTIVITY_WINDOW_MS) {
                    api.presencePing(token, inMatchMode)?.let { friends ->
                        _uiState.update { it.copy(friends = friends) }
                    }
                }
                delay(PRESENCE_TICK_MS)
            }
        }
    }

    /** One-shot friends refresh, used when the friends list appears. */
    fun refreshFriends() {
        val token = prefs.sessionToken ?: return
        viewModelScope.launch {
            api.friends(token)?.let { friends ->
                _uiState.update { it.copy(friends = friends) }
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
            val guestSecret = (_uiState.value.identity as? Identity.Guest)?.session?.guestSecret ?: prefs.guestSecret
            when (val outcome = api.register(username, email, password, guestId, guestSecret, transferGuestStats)) {
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

    fun requestPasswordReset(identifier: String) {
        if (_uiState.value.busy) return
        _uiState.update { it.copy(busy = true, fieldErrors = emptyMap(), error = null, notice = null) }

        viewModelScope.launch {
            when (val outcome = api.requestPasswordReset(identifier)) {
                is AuthOutcome.Ok -> _uiState.update {
                    it.copy(
                        busy = false,
                        notice = "If that account exists, a password reset email is on the way."
                    )
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

    fun resetPassword(token: String, password: String, onSuccess: () -> Unit) {
        if (_uiState.value.busy) return
        _uiState.update { it.copy(busy = true, fieldErrors = emptyMap(), error = null, notice = null) }

        viewModelScope.launch {
            when (val outcome = api.resetPassword(token, password)) {
                is AuthOutcome.Ok -> {
                    adoptSession(outcome.value)
                    _uiState.update {
                        it.copy(busy = false, notice = "Password reset. You're signed in.")
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
        _guestExpiry.value = null

        prefs.sessionToken = result.token
        prefs.playerName = result.profile.username
        // The guest id is now owned by the server (retired if transferred).
        prefs.guestId = null
        prefs.guestSecret = null
        _uiState.update {
            it.copy(
                identity = Identity.Registered(result.profile),
                friends = result.profile.friends
            )
        }
        startPresence()
    }

    fun logout() {
        val token = prefs.sessionToken
        prefs.sessionToken = null
        presenceJob?.cancel()
        presenceJob = null
        inMatchMode = null
        _uiState.update {
            it.copy(identity = Identity.Unknown, friends = emptyList(), notice = "Signed out.")
        }

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
                is AuthOutcome.Ok -> {
                    _uiState.update {
                        it.copy(
                            busy = false,
                            identity = Identity.Registered(outcome.value),
                            friends = outcome.value.friends,
                            notice = "Added $username."
                        )
                    }
                    // Pull presence for the new friend straight away.
                    refreshFriends()
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
                        friends = outcome.value.friends,
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
                        _uiState.update {
                            it.copy(identity = Identity.Registered(profile), friends = profile.friends)
                        }
                    }
                }

                is Identity.Guest -> {
                    val secret = current.session.guestSecret ?: prefs.guestSecret
                    if (secret == null) {
                        handleLapse()
                        return@launch
                    }
                    val refreshed = api.guestMe(current.session.guestId, secret)
                    if (refreshed != null) {
                        val adopted = rememberGuestSession(refreshed, secret)
                        _uiState.update { it.copy(identity = Identity.Guest(adopted)) }
                        publishExpiry(adopted.expiresAt)
                    } else {
                        // The id lapsed while we were away — take a fresh one.
                        handleLapse()
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
        noteActivity()

        val current = _uiState.value.identity
        if (current !is Identity.Guest) return
        _uiState.update {
            it.copy(identity = Identity.Guest(current.session.copy(displayName = trimmed)))
        }
        viewModelScope.launch {
            val secret = current.session.guestSecret ?: prefs.guestSecret
            api.guestSession(current.session.guestId, secret, trimmed)?.let { session ->
                val adopted = rememberGuestSession(session, secret)
                _uiState.update { it.copy(identity = Identity.Guest(adopted)) }
                publishExpiry(adopted.expiresAt)
            }
        }
    }

    fun clearMessages() {
        _uiState.update { it.copy(error = null, notice = null, fieldErrors = emptyMap()) }
    }

    override fun onCleared() {
        super.onCleared()
        heartbeatJob?.cancel()
        presenceJob?.cancel()
        tickerJob?.cancel()
        api.shutdown()
    }

    private fun rememberGuestSession(session: GuestSession, fallbackSecret: String? = prefs.guestSecret): GuestSession {
        val secret = session.guestSecret ?: fallbackSecret
        prefs.guestId = session.guestId
        prefs.guestSecret = secret
        return session.copy(guestSecret = secret)
    }
}
