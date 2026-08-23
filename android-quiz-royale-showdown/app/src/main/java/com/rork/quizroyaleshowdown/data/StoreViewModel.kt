package com.rork.quizroyaleshowdown.data

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class StoreUiState(
    val balances: VirtualCurrencyBalances = VirtualCurrencyBalances(),
    val items: List<StoreItem> = emptyList(),
    val cosmetics: List<CosmeticItem> = emptyList(),
    val loading: Boolean = true,
    val busyItemId: String? = null,
    val error: String? = null,
    val notice: String? = null
)

class StoreViewModel(app: Application) : AndroidViewModel(app) {
    private val api = AuthApi()
    private val prefs = PlayerPrefs(app)

    private val _uiState = MutableStateFlow(StoreUiState())
    val uiState: StateFlow<StoreUiState> = _uiState.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        val token = prefs.sessionToken
        if (token == null) {
            _uiState.update {
                it.copy(loading = false, error = "Register or sign in to use the store.")
            }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(loading = true, error = null) }
            val store = api.storeItems(token)
            val cosmetics = api.cosmetics(token)
            _uiState.update {
                if (store == null || cosmetics == null) {
                    it.copy(loading = false, error = "Could not load the store.")
                } else {
                    it.copy(
                        loading = false,
                        balances = store.balances,
                        items = store.items,
                        cosmetics = cosmetics,
                        error = null
                    )
                }
            }
        }
    }

    fun purchase(item: StoreItem) {
        val token = prefs.sessionToken ?: return
        if (_uiState.value.busyItemId != null) return
        viewModelScope.launch {
            _uiState.update { it.copy(busyItemId = item.itemId, error = null, notice = null) }
            when (val outcome = api.purchaseStoreItem(token, item.itemId)) {
                is AuthOutcome.Ok -> _uiState.update {
                    it.copy(
                        busyItemId = null,
                        balances = outcome.value.balances,
                        items = outcome.value.items,
                        cosmetics = outcome.value.cosmetics,
                        notice = if (outcome.value.duplicate) "Purchase already applied." else "Purchased ${item.displayName}."
                    )
                }

                is AuthOutcome.Invalid -> _uiState.update {
                    it.copy(busyItemId = null, error = outcome.message ?: "Purchase failed.")
                }

                is AuthOutcome.Failed -> _uiState.update {
                    it.copy(busyItemId = null, error = outcome.message)
                }
            }
        }
    }

    fun equip(cosmetic: CosmeticItem) {
        val token = prefs.sessionToken ?: return
        if (_uiState.value.busyItemId != null) return
        viewModelScope.launch {
            _uiState.update { it.copy(busyItemId = cosmetic.cosmeticId, error = null, notice = null) }
            when (val outcome = api.equipCosmetic(token, cosmetic.cosmeticId)) {
                is AuthOutcome.Ok -> _uiState.update {
                    it.copy(
                        busyItemId = null,
                        cosmetics = outcome.value.cosmetics,
                        notice = "Equipped ${cosmetic.displayName}."
                    )
                }

                is AuthOutcome.Invalid -> _uiState.update {
                    it.copy(busyItemId = null, error = outcome.message ?: "Could not equip that cosmetic.")
                }

                is AuthOutcome.Failed -> _uiState.update {
                    it.copy(busyItemId = null, error = outcome.message)
                }
            }
        }
    }

    fun clearMessages() {
        _uiState.update { it.copy(error = null, notice = null) }
    }

    override fun onCleared() {
        super.onCleared()
        api.shutdown()
    }
}
