package com.rork.quizroyaleshowdown.data

import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

private const val TAG = "MatchViewModel"
private const val MAX_RECONNECT_ATTEMPTS = 4

enum class ConnectionStatus { IDLE, MATCHMAKING, CONNECTING, CONNECTED, RECONNECTING, FAILED }

data class MatchUiState(
    val status: ConnectionStatus = ConnectionStatus.IDLE,
    val match: PublicMatch? = null,
    val you: YouState? = null,
    val errorMessage: String? = null,
    val clockOffsetMs: Long = 0L,
    val lastRevealedRound: Int = 0
)

class MatchViewModel(app: Application) : AndroidViewModel(app) {

    private val prefs = PlayerPrefs(app)
    private val client = GameClient()
    private val outbound = OutboundQueue()

    private val _uiState = MutableStateFlow(MatchUiState())
    val uiState: StateFlow<MatchUiState> = _uiState.asStateFlow()

    private var sessionJob: Job? = null
    private var recordedResult = false
    private var pendingPrivateCode: String? = null

    val playerName: String get() = prefs.playerName

    private val credentials: MatchCredentials
        get() {
            val token = prefs.sessionToken
            return if (token != null) {
                MatchCredentials(token = token, guestId = null, guestSecret = null)
            } else {
                MatchCredentials(token = null, guestId = prefs.guestId, guestSecret = prefs.guestSecret)
            }
        }

    fun preparePrivateMatch(code: String) {
        pendingPrivateCode = code.trim().uppercase().takeIf { it.length == 6 }
    }

    fun startMatch(mode: GameMode) {
        val privateCode = pendingPrivateCode.also { pendingPrivateCode = null }
        if (privateCode != null) {
            startSession { client.joinPrivateMatch(privateCode, credentials).asMatchmakeResponse() }
        } else {
            startSession { client.findMatch(mode) }
        }
    }

    private fun startSession(assignmentProvider: suspend () -> MatchmakeResponse) {
        sessionJob?.cancel()
        recordedResult = false
        _uiState.value = MatchUiState(status = ConnectionStatus.MATCHMAKING)

        sessionJob = viewModelScope.launch {
            var attempt = 0
            var assignment: MatchmakeResponse? = null

            while (isActive && attempt <= MAX_RECONNECT_ATTEMPTS) {
                try {
                    if (assignment == null) assignment = assignmentProvider()
                    val activeAssignment = assignment
                    _uiState.update {
                        it.copy(
                            status = if (attempt == 0) ConnectionStatus.CONNECTING else ConnectionStatus.RECONNECTING,
                            errorMessage = null
                        )
                    }

                    client.connect(
                        roomId = activeAssignment.roomId,
                        roomTicket = activeAssignment.roomTicket,
                        credentials = credentials,
                        name = prefs.playerName,
                        mode = activeAssignment.mode,
                        outbound = outbound
                    ).collect { message -> handleMessage(message) }

                    if (_uiState.value.match?.phase == Phase.FINISHED) return@launch
                    attempt += 1
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.w(TAG, "Match session failure (${e::class.simpleName}): ${e.message}")
                    attempt += 1
                }

                if (attempt > MAX_RECONNECT_ATTEMPTS) break
                _uiState.update { it.copy(status = ConnectionStatus.RECONNECTING) }
                delay(600L * attempt)
            }

            if (isActive && _uiState.value.match?.phase != Phase.FINISHED) {
                _uiState.update {
                    it.copy(
                        status = ConnectionStatus.FAILED,
                        errorMessage = "Lost contact with the arena. Check your connection and try again."
                    )
                }
            }
        }
    }

    private fun handleMessage(message: ServerMessage) {
        when (message) {
            is ServerMessage.State -> {
                val offset = message.match.serverNow - System.currentTimeMillis()
                _uiState.update { current ->
                    val revealed = if (message.match.phase == Phase.REVEAL) message.match.roundNumber else current.lastRevealedRound
                    current.copy(
                        status = ConnectionStatus.CONNECTED,
                        match = message.match,
                        you = message.you,
                        clockOffsetMs = offset,
                        lastRevealedRound = revealed,
                        errorMessage = null
                    )
                }
                if (message.match.phase == Phase.FINISHED) recordResult(message)
            }
            is ServerMessage.Error -> {
                Log.d(TAG, "Server rejected action ${message.code}: ${message.message}")
                _uiState.update { it.copy(errorMessage = message.message) }
            }
            is ServerMessage.Pong -> _uiState.update {
                it.copy(clockOffsetMs = message.serverNow - System.currentTimeMillis())
            }
        }
    }

    private fun recordResult(message: ServerMessage.State) {
        if (recordedResult) return
        recordedResult = true
        val you = message.you
        if (message.match.mode == GameMode.PRACTICE) return
        if (you.score > prefs.bestScore) prefs.bestScore = you.score
        val place = you.placement
        if (place != null) {
            val best = prefs.bestPlacement
            if (best == 0 || place < best) prefs.bestPlacement = place
            if (place == 1) prefs.wins += 1
        }
    }

    fun submitAnswer(index: Int) {
        val state = _uiState.value
        val question = state.match?.question ?: return
        if (state.match.phase != Phase.QUESTION || state.you?.answerIndex != null) return
        viewModelScope.launch { outbound.send(ClientMessage.SubmitAnswer(question.id, index)) }
    }

    fun usePowerUp(powerUp: PowerUp) {
        val state = _uiState.value
        if (state.match?.phase != Phase.QUESTION) return
        if (state.you?.availablePowerUps?.contains(powerUp) != true) return
        viewModelScope.launch { outbound.send(ClientMessage.UsePowerUp(powerUp)) }
    }

    fun leaveMatch() {
        viewModelScope.launch {
            outbound.send(ClientMessage.LeaveMatch)
            sessionJob?.cancel()
            sessionJob = null
            _uiState.value = MatchUiState()
        }
    }

    fun dismissError() { _uiState.update { it.copy(errorMessage = null) } }

    override fun onCleared() {
        super.onCleared()
        sessionJob?.cancel()
        client.shutdown()
    }
}
