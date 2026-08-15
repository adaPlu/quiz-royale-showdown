package com.rork.quizroyaleshowdown.data

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

const val WORLD_BOARD = "WORLD"

data class LeaderboardUiState(
    val boards: List<String> = listOf(WORLD_BOARD),
    val selectedBoard: String = WORLD_BOARD,
    val page: LeaderboardPage? = null,
    val loading: Boolean = true,
    val error: String? = null
)

/**
 * Loads the world and category boards. Ranks come straight from the server so a
 * guest and a registered player are ordered by the same rule.
 */
class LeaderboardViewModel(app: Application) : AndroidViewModel(app) {

    private val api = AuthApi()
    private val prefs = PlayerPrefs(app)

    private val _uiState = MutableStateFlow(LeaderboardUiState())
    val uiState: StateFlow<LeaderboardUiState> = _uiState.asStateFlow()

    private var loadJob: Job? = null

    init {
        viewModelScope.launch {
            val boards = api.boards()
            _uiState.update { it.copy(boards = boards.ifEmpty { listOf(WORLD_BOARD) }) }
            load(WORLD_BOARD)
        }
    }

    fun select(board: String) {
        if (_uiState.value.selectedBoard == board && _uiState.value.page != null) return
        load(board)
    }

    fun refresh() {
        load(_uiState.value.selectedBoard)
    }

    private fun load(board: String) {
        loadJob?.cancel()
        _uiState.update { it.copy(selectedBoard = board, loading = true, error = null) }

        loadJob = viewModelScope.launch {
            // Highlighting "you" works for either identity kind.
            val subjectId = prefs.sessionToken?.let { token -> api.me(token)?.userId }
                ?: prefs.guestId

            val page = api.leaderboard(board, subjectId)
            _uiState.update {
                if (page == null) {
                    it.copy(loading = false, error = "Could not load the leaderboard.")
                } else {
                    it.copy(loading = false, page = page, error = null)
                }
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        api.shutdown()
    }
}
