package com.rork.quizroyaleshowdown.data

import android.util.Log
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import java.io.IOException

@Serializable
data class PaidCurrencyProduct(
    val productId: String,
    val currency: String,
    val amount: Int
)

@Serializable
data class CurrencyPacksEnvelope(
    val products: List<PaidCurrencyProduct> = emptyList(),
    val balances: VirtualCurrencyBalances = VirtualCurrencyBalances(),
    val platform: String = "google_play",
    val accountBinding: String = ""
)

@Serializable
data class PlayPurchaseGrant(
    val ok: Boolean = false,
    val duplicate: Boolean = false,
    val productId: String = "",
    val currency: String? = null,
    val grantedAmount: Int = 0,
    val balances: VirtualCurrencyBalances = VirtualCurrencyBalances(),
    val playFinalized: Boolean = false
)

/**
 * Paid-currency API surface. Google Play purchase tokens are sent to Railway
 * over TLS and are never written to local storage. Railway independently
 * verifies the token before crediting coins/gems and finalizes the consumable
 * with Google Play after the grant is committed.
 */
class CommerceApi {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val http = HttpClient(OkHttp) {
        install(ContentNegotiation) { json(json) }
    }
    private val base: String get() = Backend.restBaseUrl

    suspend fun currencyPacks(token: String): CurrencyPacksEnvelope? = runCatching {
        val response = http.get("$base/store/currency-packs") {
            header("Authorization", "Bearer $token")
        }
        if (!response.status.isSuccess()) return null
        response.body<CurrencyPacksEnvelope>()
    }.getOrElse {
        Log.w(TAG, "Currency pack fetch failed: ${it.message}")
        null
    }

    suspend fun verifyGooglePlayPurchase(
        token: String,
        productId: String,
        purchaseToken: String
    ): AuthOutcome<PlayPurchaseGrant> = runOutcomeCall {
        http.post("$base/store/google-play/verify") {
            header("Authorization", "Bearer $token")
            contentType(ContentType.Application.Json)
            setBody(
                buildJsonObject {
                    put("productId", JsonPrimitive(productId))
                    put("purchaseToken", JsonPrimitive(purchaseToken))
                }
            )
        }
    }

    fun shutdown() {
        runCatching { http.close() }
    }

    private suspend inline fun <reified T> runOutcomeCall(
        noinline block: suspend () -> HttpResponse
    ): AuthOutcome<T> = try {
        val response = block()
        if (response.status.isSuccess()) {
            AuthOutcome.Ok(response.body<T>())
        } else {
            decodeError(response)
        }
    } catch (e: IOException) {
        Log.w(TAG, "Commerce call network failure: ${e.message}")
        AuthOutcome.Failed("Can't reach the store. Check your connection.")
    } catch (e: IllegalStateException) {
        Log.w(TAG, "Commerce response decode failure: ${e.message}")
        AuthOutcome.Failed("Unexpected purchase response from the server.")
    }

    private suspend fun <T> decodeError(response: HttpResponse): AuthOutcome<T> {
        val raw = runCatching { response.bodyAsText() }.getOrDefault("")
        val parsed = runCatching { json.decodeFromString<ApiError>(raw) }.getOrNull()
        return when {
            parsed == null -> AuthOutcome.Failed("Purchase verification failed.")
            parsed.fields.isNotEmpty() -> AuthOutcome.Invalid(parsed.fields, parsed.message)
            else -> AuthOutcome.Failed(parsed.message ?: "Purchase verification failed.")
        }
    }

    private companion object {
        const val TAG = "CommerceApi"
    }
}
