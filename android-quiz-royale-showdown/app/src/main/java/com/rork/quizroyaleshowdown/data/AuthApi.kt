package com.rork.quizroyaleshowdown.data

import android.util.Log
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import java.io.IOException

private const val TAG = "AuthApi"

/**
 * HTTP surface for identity: registration, login, guest sessions, friends and
 * leaderboards. Credentials are only ever sent — never cached here.
 */
class AuthApi {

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    private val http = HttpClient(OkHttp) {
        install(ContentNegotiation) { json(json) }
    }

    private val base: String get() = Backend.baseUrl

    // ------------------------------------------------------------ registration

    suspend fun register(
        username: String,
        email: String,
        password: String,
        guestId: String?,
        transferStats: Boolean
    ): AuthOutcome<AuthResult> = runAuthCall {
        http.post("$base/auth/register") {
            contentType(ContentType.Application.Json)
            setBody(
                buildJsonObject {
                    put("username", JsonPrimitive(username))
                    put("email", JsonPrimitive(email))
                    put("password", JsonPrimitive(password))
                    if (guestId != null && transferStats) {
                        put("guestId", JsonPrimitive(guestId))
                        put("transferStats", JsonPrimitive(true))
                    }
                }
            )
        }
    }

    suspend fun login(identifier: String, password: String): AuthOutcome<AuthResult> = runAuthCall {
        http.post("$base/auth/login") {
            contentType(ContentType.Application.Json)
            setBody(
                buildJsonObject {
                    put("identifier", JsonPrimitive(identifier))
                    put("password", JsonPrimitive(password))
                }
            )
        }
    }

    suspend fun requestPasswordReset(identifier: String): AuthOutcome<PasswordResetRequestResult> =
        runOutcomeCall {
            http.post("$base/auth/forgot-password") {
                contentType(ContentType.Application.Json)
                setBody(buildJsonObject { put("identifier", JsonPrimitive(identifier)) })
            }
        }

    suspend fun resetPassword(token: String, password: String): AuthOutcome<AuthResult> =
        runAuthCall {
            http.post("$base/auth/reset-password") {
                contentType(ContentType.Application.Json)
                setBody(
                    buildJsonObject {
                        put("token", JsonPrimitive(token))
                        put("password", JsonPrimitive(password))
                    }
                )
            }
        }

    suspend fun logout(token: String) {
        runCatching {
            http.post("$base/auth/logout") { header("Authorization", "Bearer $token") }
        }.onFailure { Log.w(TAG, "Logout call failed: ${it.message}") }
    }

    suspend fun me(token: String): UserProfile? = runCatching {
        val response = http.get("$base/auth/me") { header("Authorization", "Bearer $token") }
        if (!response.status.isSuccess()) return null
        response.body<ProfileEnvelope>().profile
    }.getOrElse {
        Log.w(TAG, "Profile fetch failed: ${it.message}")
        null
    }

    // ------------------------------------------------------------------ guests

    /**
     * Issues a guest id, or renews [existingId] when it is still alive so a
     * returning player keeps their run.
     */
    suspend fun guestSession(existingId: String?, displayName: String): GuestSession? = runCatching {
        val response = http.post("$base/guest/session") {
            contentType(ContentType.Application.Json)
            setBody(
                buildJsonObject {
                    if (existingId != null) put("guestId", JsonPrimitive(existingId))
                    put("displayName", JsonPrimitive(displayName))
                }
            )
        }
        if (!response.status.isSuccess()) return null
        response.body<GuestSessionEnvelope>().guest
    }.getOrElse {
        Log.w(TAG, "Guest session failed: ${it.message}")
        null
    }

    /** Slides the guest's expiry forward. Null means the id already lapsed. */
    suspend fun guestHeartbeat(guestId: String): GuestSession? = runCatching {
        val response = http.post("$base/guest/heartbeat") {
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("guestId", JsonPrimitive(guestId)) })
        }
        if (!response.status.isSuccess()) return null
        response.body<GuestSessionEnvelope>().guest
    }.getOrElse { null }

    suspend fun guestMe(guestId: String): GuestSession? = runCatching {
        val response = http.get("$base/guest/me") { parameter("guestId", guestId) }
        if (!response.status.isSuccess()) return null
        response.body<GuestSessionEnvelope>().guest
    }.getOrElse { null }

    /** Retires a guest id immediately rather than waiting for the TTL sweep. */
    suspend fun endGuest(guestId: String) {
        runCatching {
            http.post("$base/guest/end") {
                contentType(ContentType.Application.Json)
                setBody(buildJsonObject { put("guestId", JsonPrimitive(guestId)) })
            }
        }.onFailure { Log.w(TAG, "Guest end failed: ${it.message}") }
    }

    // ----------------------------------------------------------------- friends

    suspend fun addFriend(token: String, username: String): AuthOutcome<UserProfile> =
        runFriendCall {
            http.post("$base/friends/add") {
                header("Authorization", "Bearer $token")
                contentType(ContentType.Application.Json)
                setBody(buildJsonObject { put("username", JsonPrimitive(username)) })
            }
        }

    suspend fun removeFriend(token: String, userId: String): AuthOutcome<UserProfile> =
        runFriendCall {
            http.post("$base/friends/remove") {
                header("Authorization", "Bearer $token")
                contentType(ContentType.Application.Json)
                setBody(buildJsonObject { put("userId", JsonPrimitive(userId)) })
            }
        }

    /**
     * Reads the friends list with live presence. Cheaper than a full profile
     * fetch, so the friends list can poll it while it is on screen.
     */
    suspend fun friends(token: String): List<Friend>? = runCatching {
        val response = http.get("$base/friends") { header("Authorization", "Bearer $token") }
        if (!response.status.isSuccess()) return null
        response.body<FriendsEnvelope>().friends
    }.getOrElse {
        Log.w(TAG, "Friends fetch failed: ${it.message}")
        null
    }

    /**
     * Reports that the player is still active, optionally in a match, and gets
     * the friends list back in the same round trip. Returns null on failure so
     * the caller can keep the last known presence rather than blanking it.
     */
    suspend fun presencePing(token: String, matchMode: String?): List<Friend>? = runCatching {
        val response = http.post("$base/presence/ping") {
            header("Authorization", "Bearer $token")
            contentType(ContentType.Application.Json)
            setBody(
                buildJsonObject {
                    put("status", JsonPrimitive(if (matchMode != null) "IN_MATCH" else "IDLE"))
                    if (matchMode != null) put("matchMode", JsonPrimitive(matchMode))
                }
            )
        }
        if (!response.status.isSuccess()) return null
        response.body<FriendsEnvelope>().friends
    }.getOrElse {
        Log.w(TAG, "Presence ping failed: ${it.message}")
        null
    }

    suspend fun searchUsers(query: String): List<UserSearchResult> = runCatching {
        val response = http.get("$base/users/search") { parameter("q", query) }
        if (!response.status.isSuccess()) return emptyList()
        response.body<UserSearchResponse>().results
    }.getOrElse { emptyList() }

    // ------------------------------------------------------------- leaderboard

    suspend fun boards(): List<String> = runCatching {
        http.get("$base/leaderboard/boards").body<BoardsResponse>().boards
    }.getOrElse { listOf("WORLD") }

    suspend fun leaderboard(board: String, subjectId: String?, limit: Int = 50): LeaderboardPage? =
        runCatching {
            val response = http.get("$base/leaderboard") {
                parameter("board", board)
                parameter("limit", limit)
                if (subjectId != null) parameter("subjectId", subjectId)
            }
            if (!response.status.isSuccess()) return null
            response.body<LeaderboardPage>()
        }.getOrElse {
            Log.w(TAG, "Leaderboard fetch failed: ${it.message}")
            null
        }

    fun shutdown() {
        runCatching { http.close() }
    }

    // ------------------------------------------------------------------ shared

    private suspend fun runAuthCall(block: suspend () -> HttpResponse): AuthOutcome<AuthResult> =
        runOutcomeCall(block)

    private suspend inline fun <reified T> runOutcomeCall(
        noinline block: suspend () -> HttpResponse
    ): AuthOutcome<T> =
        try {
            val response = block()
            if (response.status.isSuccess()) {
                AuthOutcome.Ok(response.body<T>())
            } else {
                decodeError(response)
            }
        } catch (e: IOException) {
            Log.w(TAG, "Auth call network failure: ${e.message}")
            AuthOutcome.Failed("Can't reach the arena. Check your connection.")
        } catch (e: IllegalStateException) {
            Log.w(TAG, "Auth call decode failure: ${e.message}")
            AuthOutcome.Failed("Unexpected response from the server.")
        }

    private suspend fun runFriendCall(block: suspend () -> HttpResponse): AuthOutcome<UserProfile> =
        try {
            val response = block()
            if (response.status.isSuccess()) {
                val profile = response.body<FriendMutationResult>().profile
                if (profile != null) {
                    AuthOutcome.Ok(profile)
                } else {
                    AuthOutcome.Failed("Server did not return an updated profile.")
                }
            } else {
                decodeError(response)
            }
        } catch (e: IOException) {
            Log.w(TAG, "Friend call network failure: ${e.message}")
            AuthOutcome.Failed("Can't reach the arena. Check your connection.")
        } catch (e: IllegalStateException) {
            Log.w(TAG, "Friend call decode failure: ${e.message}")
            AuthOutcome.Failed("Unexpected response from the server.")
        }

    /** Turns a non-2xx body into field errors when the server supplied them. */
    private suspend fun <T> decodeError(response: HttpResponse): AuthOutcome<T> {
        val raw = runCatching { response.bodyAsText() }.getOrDefault("")
        val parsed = runCatching { json.decodeFromString<ApiError>(raw) }.getOrNull()

        return when {
            parsed == null -> AuthOutcome.Failed("Something went wrong. Please try again.")
            parsed.fields.isNotEmpty() -> AuthOutcome.Invalid(parsed.fields, parsed.message)
            else -> AuthOutcome.Failed(parsed.message ?: "Something went wrong. Please try again.")
        }
    }
}
