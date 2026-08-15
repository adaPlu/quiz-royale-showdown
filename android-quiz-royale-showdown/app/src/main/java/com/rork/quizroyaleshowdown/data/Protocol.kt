package com.rork.quizroyaleshowdown.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Kotlin mirror of `functions/protocol.ts`. The server is authoritative for
 * every field here — the client never computes scores, eliminations, or
 * correctness locally.
 */

@Serializable
enum class GameMode {
    @SerialName("QUICK") QUICK,
    @SerialName("TOURNAMENT") TOURNAMENT,
    @SerialName("PRACTICE") PRACTICE
}

@Serializable
enum class Phase {
    @SerialName("LOBBY") LOBBY,
    @SerialName("QUESTION") QUESTION,
    @SerialName("REVEAL") REVEAL,
    @SerialName("FINISHED") FINISHED
}

@Serializable
enum class PowerUp {
    @SerialName("FIFTY_FIFTY") FIFTY_FIFTY,
    @SerialName("SHIELD") SHIELD,
    @SerialName("DOUBLE_DOWN") DOUBLE_DOWN
}

@Serializable
data class PublicQuestion(
    val id: String,
    val category: String,
    val difficulty: String,
    val text: String,
    val options: List<String>
)

@Serializable
data class PublicPlayer(
    val id: String,
    val name: String,
    val isBot: Boolean,
    val alive: Boolean,
    val score: Int,
    val streak: Int,
    val lives: Int,
    val hasAnswered: Boolean,
    val lastAnswerCorrect: Boolean? = null,
    val placement: Int? = null
)

@Serializable
data class PublicMatch(
    val matchId: String,
    val mode: GameMode,
    val phase: Phase,
    val roundNumber: Int,
    val totalRounds: Int,
    val phaseEndsAt: Long,
    val serverNow: Long,
    val question: PublicQuestion? = null,
    val correctIndex: Int? = null,
    val players: List<PublicPlayer> = emptyList(),
    val aliveCount: Int = 0,
    val totalPlayers: Int = 0,
    val winnerId: String? = null
)

@Serializable
data class YouState(
    val playerId: String,
    val alive: Boolean,
    val score: Int,
    val streak: Int,
    val lives: Int,
    val placement: Int? = null,
    val answerIndex: Int? = null,
    val removedOptions: List<Int> = emptyList(),
    val availablePowerUps: List<PowerUp> = emptyList(),
    val shieldActive: Boolean = false,
    val doubleActive: Boolean = false
)

@Serializable
data class MatchmakeResponse(
    val roomId: String,
    val mode: GameMode,
    val playersWaiting: Int = 1,
    val lobbyEndsAt: Long = 0L
)

// ---------------- Server -> Client ----------------

@Serializable
sealed class ServerMessage {
    @Serializable
    @SerialName("STATE")
    data class State(val match: PublicMatch, val you: YouState) : ServerMessage()

    @Serializable
    @SerialName("ERROR")
    data class Error(val code: String, val message: String) : ServerMessage()

    @Serializable
    @SerialName("PONG")
    data class Pong(val serverNow: Long) : ServerMessage()
}

// ---------------- Client -> Server ----------------

@Serializable
sealed class ClientMessage {
    @Serializable
    @SerialName("JOIN_MATCH")
    data class JoinMatch(val name: String) : ClientMessage()

    @Serializable
    @SerialName("SUBMIT_ANSWER")
    data class SubmitAnswer(val questionId: String, val answerIndex: Int) : ClientMessage()

    @Serializable
    @SerialName("USE_POWERUP")
    data class UsePowerUp(val powerUp: PowerUp) : ClientMessage()

    @Serializable
    @SerialName("LEAVE_MATCH")
    data object LeaveMatch : ClientMessage()

    @Serializable
    @SerialName("PING")
    data object Ping : ClientMessage()
}

/** Presentation metadata for each mode, kept next to the protocol enum. */
data class ModeInfo(
    val mode: GameMode,
    val title: String,
    val tagline: String,
    val description: String,
    val rounds: Int,
    val lives: Int,
    val maxPlayers: Int,
    /** Mirrors MODE_CONFIG on the server so timer bars can show progress. */
    val lobbyMs: Long,
    val questionMs: Long,
    val revealMs: Long
)

val MODE_INFO: Map<GameMode, ModeInfo> = mapOf(
    GameMode.QUICK to ModeInfo(
        mode = GameMode.QUICK,
        title = "QUICK MATCH",
        tagline = "One life. Twelve rounds.",
        description = "Drop into the next open lobby. A single wrong answer ends your run.",
        rounds = 12,
        lives = 1,
        maxPlayers = 12,
        lobbyMs = 12_000L,
        questionMs = 12_000L,
        revealMs = 4_500L
    ),
    GameMode.TOURNAMENT to ModeInfo(
        mode = GameMode.TOURNAMENT,
        title = "TOURNAMENT",
        tagline = "Two lives. Bigger arena.",
        description = "Sixteen players, fifteen brutal rounds and a shorter clock. Survive to the crown.",
        rounds = 15,
        lives = 2,
        maxPlayers = 16,
        lobbyMs = 15_000L,
        questionMs = 10_000L,
        revealMs = 4_000L
    ),
    GameMode.PRACTICE to ModeInfo(
        mode = GameMode.PRACTICE,
        title = "PRACTICE",
        tagline = "No elimination. No pressure.",
        description = "Solo run through ten questions with a relaxed clock. Nothing can knock you out.",
        rounds = 10,
        lives = 0,
        maxPlayers = 1,
        lobbyMs = 2_500L,
        questionMs = 18_000L,
        revealMs = 5_000L
    )
)

val PowerUp.displayName: String
    get() = when (this) {
        PowerUp.FIFTY_FIFTY -> "50:50"
        PowerUp.SHIELD -> "Shield"
        PowerUp.DOUBLE_DOWN -> "Double"
    }

val PowerUp.hint: String
    get() = when (this) {
        PowerUp.FIFTY_FIFTY -> "Burns two wrong answers, but pays 40% fewer points."
        PowerUp.SHIELD -> "Survive one wrong answer this round."
        PowerUp.DOUBLE_DOWN -> "Double points if right — instant knockout if wrong."
    }
