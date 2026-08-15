package com.rork.quizroyaleshowdown.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Client mirror of the server's identity contract. Guest and registered
 * identities are deliberately separate types rather than one type with nullable
 * credential fields — a guest simply has no email, password or friends list.
 */

@Serializable
data class PlayerStats(
    val wins: Int = 0,
    val losses: Int = 0,
    val matchesPlayed: Int = 0,
    val totalPoints: Int = 0,
    val bestScore: Int = 0,
    val bestPlacement: Int? = null,
    val correctAnswers: Int = 0,
    val powerUpsUsed: Int = 0,
    val powerUpCharges: Int = 0,
    val categoryPoints: Map<String, Int> = emptyMap(),
    /**
     * Best world leaderboard rank ever held, captured server-side at the moment
     * it was reached — so a milestone badge stays earned after being overtaken.
     */
    val bestRank: Int? = null
)

/** A temporary identity. Note the absence of email/password/friends. */
@Serializable
data class GuestSession(
    val guestId: String,
    val displayName: String,
    /** Epoch ms at which this id lapses unless the player stays active. */
    val expiresAt: Long,
    val stats: PlayerStats = PlayerStats()
)

/** What a friend is doing right now, as reported by the server. */
enum class PresenceStatus { OFFLINE, ONLINE, IN_MATCH }

@Serializable
data class Friend(
    val userId: String,
    val username: String,
    val totalPoints: Int = 0,
    val wins: Int = 0,
    val addedAt: Long = 0L,
    /** Raw wire value; read [status] instead so an unknown value is safe. */
    val presence: String = "OFFLINE",
    /** Mode name while in a match, null otherwise. */
    val matchMode: String? = null,
    val lastSeenAt: Long = 0L
) {
    val status: PresenceStatus
        get() = when (presence) {
            "IN_MATCH" -> PresenceStatus.IN_MATCH
            "ONLINE" -> PresenceStatus.ONLINE
            else -> PresenceStatus.OFFLINE
        }
}

@Serializable
data class FriendsEnvelope(val friends: List<Friend> = emptyList())

/** A durable identity: credentials, a friends graph and persistent stats. */
@Serializable
data class UserProfile(
    val userId: String,
    val username: String,
    val email: String,
    val createdAt: Long = 0L,
    val stats: PlayerStats = PlayerStats(),
    val friends: List<Friend> = emptyList()
)

@Serializable
data class GuestSessionEnvelope(val guest: GuestSession, val reused: Boolean = false)

@Serializable
data class ProfileEnvelope(val profile: UserProfile)

@Serializable
data class AuthResult(
    val token: String,
    val expiresAt: Long,
    val profile: UserProfile,
    val transferredFromGuest: Boolean = false
)

@Serializable
data class PasswordResetRequestResult(val ok: Boolean = false)

@Serializable
data class FriendMutationResult(val ok: Boolean = false, val profile: UserProfile? = null)

@Serializable
data class LeaderboardEntry(
    val rank: Int,
    val subjectKind: String,
    val subjectId: String,
    val displayName: String,
    val points: Int,
    val wins: Int,
    val isYou: Boolean = false
) {
    val isGuest: Boolean get() = subjectKind == "GUEST"
}

@Serializable
data class LeaderboardPage(
    val board: String,
    val entries: List<LeaderboardEntry> = emptyList(),
    val yourRank: Int? = null,
    val yourPoints: Int = 0,
    val totalRanked: Int = 0
)

@Serializable
data class BoardsResponse(val boards: List<String> = emptyList())

@Serializable
data class UserSearchResult(val userId: String, val username: String)

@Serializable
data class UserSearchResponse(val results: List<UserSearchResult> = emptyList())

/** Shape of every failure the server returns. */
@Serializable
data class ApiError(
    @SerialName("error") val code: String = "unknown",
    val message: String? = null,
    val fields: Map<String, String> = emptyMap()
)

/**
 * Result of a call that can fail with per-field validation errors, so the auth
 * form can attach messages to the exact input that was wrong.
 */
sealed interface AuthOutcome<out T> {
    data class Ok<T>(val value: T) : AuthOutcome<T>
    data class Invalid(val fields: Map<String, String>, val message: String?) : AuthOutcome<Nothing>
    data class Failed(val message: String) : AuthOutcome<Nothing>
}

/** The player's current identity. */
sealed interface Identity {
    /** Still bootstrapping — we do not yet know who the player is. */
    data object Unknown : Identity

    data class Guest(val session: GuestSession) : Identity

    data class Registered(val profile: UserProfile) : Identity

    val stats: PlayerStats?
        get() = when (this) {
            is Guest -> session.stats
            is Registered -> profile.stats
            Unknown -> null
        }

    val displayName: String
        get() = when (this) {
            is Guest -> session.displayName
            is Registered -> profile.username
            Unknown -> "Challenger"
        }

    val subjectId: String?
        get() = when (this) {
            is Guest -> session.guestId
            is Registered -> profile.userId
            Unknown -> null
        }

    val isRegistered: Boolean get() = this is Registered
}
