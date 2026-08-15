package com.rork.quizroyaleshowdown.data

import android.content.Context
import android.content.SharedPreferences
import java.util.UUID

/**
 * Local identity store.
 *
 * Holds the display name, a stable device id, the temporary guest id and — for
 * registered players — the opaque session token. The password is NEVER stored,
 * cached or written to disk in any form: it is sent once over TLS and the server
 * keeps only a salted PBKDF2 derivation of it.
 */
class PlayerPrefs(context: Context) {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences("quiz_royale", Context.MODE_PRIVATE)

    /** Stable per-install id. Used only for matchmaking bucketing. */
    val deviceId: String
        get() {
            prefs.getString(KEY_ID, null)?.let { return it }
            val fresh = UUID.randomUUID().toString()
            prefs.edit().putString(KEY_ID, fresh).apply()
            return fresh
        }

    var playerName: String
        get() = prefs.getString(KEY_NAME, null)?.takeIf { it.isNotBlank() } ?: defaultName()
        set(value) {
            prefs.edit().putString(KEY_NAME, value.trim().take(16)).apply()
        }

    /** Opaque bearer token for a registered session. Null when playing as guest. */
    var sessionToken: String?
        get() = prefs.getString(KEY_TOKEN, null)?.takeIf { it.isNotBlank() }
        set(value) {
            prefs.edit().apply {
                if (value.isNullOrBlank()) remove(KEY_TOKEN) else putString(KEY_TOKEN, value)
            }.apply()
        }

    /** The current temporary guest id, if one has been issued. */
    var guestId: String?
        get() = prefs.getString(KEY_GUEST_ID, null)?.takeIf { it.isNotBlank() }
        set(value) {
            prefs.edit().apply {
                if (value.isNullOrBlank()) remove(KEY_GUEST_ID) else putString(KEY_GUEST_ID, value)
            }.apply()
        }

    /** Offline fallback record, shown before the server stats land. */
    var bestPlacement: Int
        get() = prefs.getInt(KEY_BEST_PLACE, 0)
        set(value) = prefs.edit().putInt(KEY_BEST_PLACE, value).apply()

    var bestScore: Int
        get() = prefs.getInt(KEY_BEST_SCORE, 0)
        set(value) = prefs.edit().putInt(KEY_BEST_SCORE, value).apply()

    var wins: Int
        get() = prefs.getInt(KEY_WINS, 0)
        set(value) = prefs.edit().putInt(KEY_WINS, value).apply()

    private fun defaultName(): String = "Player${(1000..9999).random()}"

    private companion object {
        const val KEY_ID = "player_id"
        const val KEY_NAME = "player_name"
        const val KEY_TOKEN = "session_token"
        const val KEY_GUEST_ID = "guest_id"
        const val KEY_BEST_PLACE = "best_placement"
        const val KEY_BEST_SCORE = "best_score"
        const val KEY_WINS = "wins"
    }
}
