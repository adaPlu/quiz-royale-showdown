package com.rork.quizroyaleshowdown.data

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class PrivateMatchUiState(
    val room: PrivateMatchResponse? = null,
    val busy: Boolean = false,
    val errorMessage: String? = null
)

class PrivateMatchViewModel(app: Application) : AndroidViewModel(app) {
    private val prefs = PlayerPrefs(app)
    private val client = GameClient()
    private val _uiState = MutableStateFlow(PrivateMatchUiState())
    val uiState: StateFlow<PrivateMatchUiState> = _uiState.asStateFlow()

    private val credentials: MatchCredentials
        get() = prefs.sessionToken?.let {
            MatchCredentials(token = it, guestId = null, guestSecret = null)
        } ?: MatchCredentials(token = null, guestId = prefs.guestId, guestSecret = prefs.guestSecret)

    fun create(mode: GameMode, difficulty: MatchDifficulty) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(busy = true, errorMessage = null)
            runCatching { client.createPrivateMatch(mode, difficulty, credentials) }
                .onSuccess { _uiState.value = PrivateMatchUiState(room = it) }
                .onFailure { _uiState.value = _uiState.value.copy(busy = false, errorMessage = it.message ?: "Could not create private room.") }
        }
    }

    fun update(mode: GameMode, difficulty: MatchDifficulty) {
        val code = _uiState.value.room?.code ?: return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(busy = true, errorMessage = null)
            runCatching { client.updatePrivateMatch(code, mode, difficulty, credentials) }
                .onSuccess { _uiState.value = PrivateMatchUiState(room = it) }
                .onFailure { _uiState.value = _uiState.value.copy(busy = false, errorMessage = it.message ?: "Could not update private room.") }
        }
    }

    fun clear() { _uiState.value = PrivateMatchUiState() }

    override fun onCleared() {
        client.shutdown()
        super.onCleared()
    }
}
