package com.rork.quizroyaleshowdown.data

import android.app.Activity
import android.content.Context
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class CurrencyPackOffer(
    val productId: String,
    val currency: String,
    val amount: Int,
    val formattedPrice: String? = null,
    val available: Boolean = false
)

data class BillingStoreState(
    val offers: List<CurrencyPackOffer> = emptyList(),
    val loading: Boolean = false,
    val connected: Boolean = false,
    val purchasingProductId: String? = null,
    val notice: String? = null,
    val error: String? = null
)

/**
 * Google Play one-time/consumable billing adapter.
 *
 * Purchase callbacks never grant currency locally. Railway supplies a stable,
 * non-PII account binding that is attached to the Play checkout. A PURCHASED
 * token is then sent to Railway; Railway verifies both the token and binding,
 * commits the idempotent currency grant, and consumes the Play purchase.
 */
class GooglePlayBillingManager(
    context: Context,
    private val prefs: PlayerPrefs
) : PurchasesUpdatedListener {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val commerceApi = CommerceApi()
    private var serverProducts: List<PaidCurrencyProduct> = emptyList()
    private var productDetails: Map<String, ProductDetails> = emptyMap()
    private var accountBinding: String? = null
    private var connecting = false

    var onVerifiedGrant: (() -> Unit)? = null

    private val _state = MutableStateFlow(BillingStoreState())
    val state: StateFlow<BillingStoreState> = _state.asStateFlow()

    private val billingClient: BillingClient = BillingClient.newBuilder(context.applicationContext)
        .setListener(this)
        .enablePendingPurchases(
            PendingPurchasesParams.newBuilder()
                .enableOneTimeProducts()
                .build()
        )
        .enableAutoServiceReconnection()
        .build()

    fun refresh() {
        val token = prefs.sessionToken
        if (token == null) {
            serverProducts = emptyList()
            productDetails = emptyMap()
            accountBinding = null
            _state.value = BillingStoreState()
            return
        }
        scope.launch {
            _state.update { it.copy(loading = true, error = null) }
            val envelope = commerceApi.currencyPacks(token)
            if (envelope == null) {
                _state.update {
                    it.copy(
                        loading = false,
                        error = "Paid currency packs are temporarily unavailable."
                    )
                }
                return@launch
            }
            serverProducts = envelope.products
            accountBinding = envelope.accountBinding.takeIf { it.isNotBlank() }
            if (accountBinding == null) {
                productDetails = emptyMap()
                publishOffers()
                _state.update {
                    it.copy(error = "Secure Google Play account binding is unavailable. Try signing in again.")
                }
                return@launch
            }
            publishOffers()
            ensureConnected()
        }
    }

    fun launchPurchase(activity: Activity, productId: String) {
        if (_state.value.purchasingProductId != null) return
        val binding = accountBinding
        val details = productDetails[productId]
        val offer = details?.oneTimePurchaseOfferDetailsList?.firstOrNull()
        val offerToken = offer?.offerToken?.takeIf { it.isNotBlank() }
        if (binding == null || details == null || offer == null || offerToken == null) {
            _state.update {
                it.copy(error = "This pack is not available from Google Play on this account yet.")
            }
            return
        }

        val productParams = BillingFlowParams.ProductDetailsParams.newBuilder()
            .setProductDetails(details)
            .setOfferToken(offerToken)
            .build()
        val params = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(listOf(productParams))
            .setObfuscatedAccountId(binding)
            .build()
        _state.update {
            it.copy(purchasingProductId = productId, error = null, notice = null)
        }
        val result = billingClient.launchBillingFlow(activity, params)
        if (result.responseCode != BillingClient.BillingResponseCode.OK) {
            _state.update {
                it.copy(
                    purchasingProductId = null,
                    error = billingMessage(result, "Could not open Google Play checkout.")
                )
            }
        }
    }

    override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> purchases.orEmpty().forEach(::processPurchase)
            BillingClient.BillingResponseCode.USER_CANCELED -> {
                _state.update { it.copy(purchasingProductId = null, notice = "Purchase canceled.") }
            }
            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> {
                _state.update { it.copy(purchasingProductId = null) }
                queryUnconsumedPurchases()
            }
            else -> {
                _state.update {
                    it.copy(
                        purchasingProductId = null,
                        error = billingMessage(result, "Google Play purchase failed.")
                    )
                }
            }
        }
    }

    fun clearMessages() {
        _state.update { it.copy(error = null, notice = null) }
    }

    fun shutdown() {
        onVerifiedGrant = null
        runCatching { billingClient.endConnection() }
        commerceApi.shutdown()
        scope.cancel()
    }

    private fun ensureConnected() {
        if (billingClient.isReady) {
            _state.update { it.copy(connected = true) }
            queryProductDetails()
            queryUnconsumedPurchases()
            return
        }
        if (connecting) return
        connecting = true
        billingClient.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                connecting = false
                if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                    _state.update { it.copy(connected = true, error = null) }
                    queryProductDetails()
                    queryUnconsumedPurchases()
                } else {
                    _state.update {
                        it.copy(
                            connected = false,
                            loading = false,
                            error = billingMessage(result, "Google Play Billing is unavailable.")
                        )
                    }
                }
            }

            override fun onBillingServiceDisconnected() {
                connecting = false
                _state.update { it.copy(connected = false) }
            }
        })
    }

    private fun queryProductDetails() {
        if (!billingClient.isReady || serverProducts.isEmpty()) {
            publishOffers()
            return
        }
        val products = serverProducts.map { pack ->
            QueryProductDetailsParams.Product.newBuilder()
                .setProductId(pack.productId)
                .setProductType(BillingClient.ProductType.INAPP)
                .build()
        }
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(products)
            .build()
        billingClient.queryProductDetailsAsync(params) { result, queryResult ->
            if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                productDetails = queryResult.productDetailsList.associateBy { it.productId }
                publishOffers()
            } else {
                productDetails = emptyMap()
                publishOffers()
                _state.update {
                    it.copy(error = billingMessage(result, "Could not load localized Google Play prices."))
                }
            }
        }
    }

    private fun publishOffers() {
        val bindingReady = !accountBinding.isNullOrBlank()
        val offers = serverProducts.map { pack ->
            val details = productDetails[pack.productId]
            val playOffer = details?.oneTimePurchaseOfferDetailsList?.firstOrNull()
            val offerToken = playOffer?.offerToken?.takeIf { it.isNotBlank() }
            CurrencyPackOffer(
                productId = pack.productId,
                currency = pack.currency,
                amount = pack.amount,
                formattedPrice = playOffer?.formattedPrice,
                available = bindingReady && playOffer != null && offerToken != null
            )
        }
        _state.update { it.copy(offers = offers, loading = false) }
    }

    private fun queryUnconsumedPurchases() {
        if (!billingClient.isReady) return
        val params = QueryPurchasesParams.newBuilder()
            .setProductType(BillingClient.ProductType.INAPP)
            .build()
        billingClient.queryPurchasesAsync(params) { result, purchases ->
            if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                purchases.forEach(::processPurchase)
            }
        }
    }

    private fun processPurchase(purchase: Purchase) {
        when (purchase.purchaseState) {
            Purchase.PurchaseState.PENDING -> {
                _state.update {
                    it.copy(
                        purchasingProductId = null,
                        notice = "Google Play purchase pending. Currency will arrive after payment completes."
                    )
                }
            }
            Purchase.PurchaseState.PURCHASED -> {
                val knownProducts = purchase.products.filter { productId ->
                    serverProducts.any { it.productId == productId }
                }
                if (knownProducts.isEmpty()) return
                knownProducts.forEach { productId -> verifyPurchase(productId, purchase) }
            }
            else -> _state.update { it.copy(purchasingProductId = null) }
        }
    }

    private fun verifyPurchase(productId: String, purchase: Purchase) {
        val token = prefs.sessionToken ?: return
        scope.launch {
            when (val outcome = commerceApi.verifyGooglePlayPurchase(
                token = token,
                productId = productId,
                purchaseToken = purchase.purchaseToken
            )) {
                is AuthOutcome.Ok -> {
                    val grant = outcome.value
                    _state.update {
                        it.copy(
                            purchasingProductId = null,
                            notice = when {
                                grant.duplicate && grant.playFinalized -> "Purchase was already credited and is finalized."
                                grant.duplicate -> "Purchase was already credited; Google Play finalization will retry automatically."
                                grant.playFinalized -> "Added ${grant.grantedAmount} ${grant.currency ?: "currency"}."
                                else -> "Added ${grant.grantedAmount} ${grant.currency ?: "currency"}; Google Play finalization will retry automatically."
                            },
                            error = null
                        )
                    }
                    onVerifiedGrant?.invoke()
                }
                is AuthOutcome.Invalid -> _state.update {
                    it.copy(
                        purchasingProductId = null,
                        error = outcome.message ?: "Google Play purchase could not be verified."
                    )
                }
                is AuthOutcome.Failed -> _state.update {
                    it.copy(purchasingProductId = null, error = outcome.message)
                }
            }
        }
    }

    private fun billingMessage(result: BillingResult, fallback: String): String =
        result.debugMessage.takeIf { it.isNotBlank() } ?: fallback
}
