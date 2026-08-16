package com.rork.quizroyaleshowdown.data

import android.util.Log
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocketSession
import io.ktor.client.request.get
import io.ktor.client.request.parameter
import io.ktor.serialization.kotlinx.json.json
import io.ktor.websocket.Frame
import io.ktor.websocket.WebSocketSession
import io.ktor.websocket.close
import io.ktor.websocket.readText
import io.ktor.websocket.send
import kotlinx.coroutines.channels.ClosedReceiveChannelException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.Json
import java.net.URLEncoder

private const val TAG = "GameClient"

/**
 * Transport for the match protocol: a small HTTP call to find a room, then a
 * persistent WebSocket carrying typed [ClientMessage] / [ServerMessage] frames.
 */
class GameClient {

    private val json = Json {
        ignoreUnknownKeys = true
        classDiscriminator = "type"
        encodeDefaults = true
    }

    private val http = HttpClient(OkHttp) {
        install(WebSockets)
        install(ContentNegotiation) { json(json) }
    }

    private val baseUrl: String get() = Backend.matchHttpBase

    /** Asks the matchmaker which room to join for [mode]. */
    suspend fun findMatch(mode: GameMode, playerId: String): MatchmakeResponse {
        return http.get("$baseUrl/matchmake") {
            parameter("mode", mode.name)
            parameter("playerId", playerId)
        }.body()
    }

    /**
     * Opens the match socket and emits every decoded server message until the
     * connection closes. Cancelling the collecting coroutine closes the socket.
     *
     * Only a credential is sent — the server resolves it into the trusted player
     * identity, so the client cannot choose who it plays as.
     */
    fun connect(
        roomId: String,
        credentials: MatchCredentials,
        name: String,
        mode: GameMode,
        outbound: OutboundQueue
    ): Flow<ServerMessage> = flow {
        val params = buildList {
            credentials.token?.let { add("token" to it) }
            credentials.guestId?.let { add("guestId" to it) }
            add("name" to name)
            add("mode" to mode.name)
        }
        val query = params.joinToString("&") { (k, v) -> "$k=${URLEncoder.encode(v, "UTF-8")}" }

        val session: WebSocketSession =
            http.webSocketSession("${Backend.webSocketBase}/match/$roomId?$query")

        outbound.bind(session, json)
        try {
            session.send(json.encodeToString<ClientMessage>(ClientMessage.JoinMatch(name)))

            for (frame in session.incoming) {
                if (frame !is Frame.Text) continue
                val raw = frame.readText()
                val decoded = runCatching { json.decodeFromString<ServerMessage>(raw) }
                    .getOrElse {
                        Log.w(TAG, "Dropping undecodable frame: ${it.message}")
                        null
                    }
                if (decoded != null) emit(decoded)
            }
        } catch (e: ClosedReceiveChannelException) {
            Log.d(TAG, "Match socket closed by server: ${e.message}")
        } finally {
            outbound.unbind()
            runCatching { session.close() }
        }
    }

    fun shutdown() {
        runCatching { http.close() }
    }
}

/**
 * Lets the ViewModel send intents without holding the socket itself. Messages
 * sent while disconnected are dropped — the server state broadcast is the
 * source of truth, so there is nothing meaningful to replay.
 */
class OutboundQueue {
    private var session: WebSocketSession? = null
    private var json: Json? = null

    fun bind(session: WebSocketSession, json: Json) {
        this.session = session
        this.json = json
    }

    fun unbind() {
        session = null
        json = null
    }

    suspend fun send(message: ClientMessage) {
        val s = session ?: return
        val j = json ?: return
        runCatching { s.send(j.encodeToString<ClientMessage>(message)) }
            .onFailure { Log.w(TAG, "Failed to send ${message::class.simpleName}: ${it.message}") }
    }
}
