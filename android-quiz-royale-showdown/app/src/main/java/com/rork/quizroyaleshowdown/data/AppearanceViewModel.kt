package com.rork.quizroyaleshowdown.data

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class AppearanceUiState(
    val equipped: List<CosmeticItem> = emptyList(),
    val loading: Boolean = false
) {
    fun equipped(type: String): CosmeticItem? = equipped.firstOrNull {
        it.cosmeticType == type && it.equipped
    }
}

/** Small read-only bridge for presenting equipped cosmetics outside Store. */
class AppearanceViewModel(app: Application) : AndroidViewModel(app) {
    private val api = AuthApi()
    private val prefs = PlayerPrefs(app)
    private val _uiState = MutableStateFlow(AppearanceUiState())
    val uiState: StateFlow<AppearanceUiState> = _uiState.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        val token = prefs.sessionToken
        if (token == null) {
            _uiState.value = AppearanceUiState()
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(loading = true) }
            val cosmetics = api.cosmetics(token).orEmpty()
            _uiState.value = AppearanceUiState(
                equipped = cosmetics.filter { it.equipped },
                loading = false
            )
        }
    }

    override fun onCleared() {
        api.shutdown()
        super.onCleared()
    }
}
