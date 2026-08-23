package com.rork.quizroyaleshowdown.data

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SeasonUiState(
    val season: Season? = null,
    val progress: SeasonProgress? = null,
    val loading: Boolean = true,
    val error: String? = null
)

class SeasonViewModel(app: Application) : AndroidViewModel(app) {
    private val api = AuthApi()
    private val prefs = PlayerPrefs(app)

    private val _uiState = MutableStateFlow(SeasonUiState())
    val uiState: StateFlow<SeasonUiState> = _uiState.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        val token = prefs.sessionToken
        if (token == null) {
            _uiState.update {
                it.copy(loading = false, error = "Register or sign in to track season progress.")
            }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(loading = true, error = null) }
            val current = api.currentSeason(token)
            _uiState.update {
                if (current == null) {
                    it.copy(loading = false, error = "Could not load the current season.")
                } else {
                    it.copy(loading = false, season = current.season, progress = current.progress, error = null)
                }
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        api.shutdown()
    }
}
