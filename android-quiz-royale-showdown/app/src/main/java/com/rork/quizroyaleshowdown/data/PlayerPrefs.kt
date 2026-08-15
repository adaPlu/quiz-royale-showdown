package com.rork.quizroyaleshowdown.data

import android.content.Context
import android.content.SharedPreferences
import java.util.UUID

/**
 * Tiny local identity store. Only the two things worth keeping between
 * sessions live here: a stable player id (so reconnects rejoin the same seat)
 * and the display name.
 */
class PlayerPrefs(context: Context) {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences("quiz_royale", Context.MODE_PRIVATE)

    val playerId: String
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

    /** Best run so far, used for the home-screen personal record. */
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
        const val KEY_BEST_PLACE = "best_placement"
        const val KEY_BEST_SCORE = "best_score"
        const val KEY_WINS = "wins"
    }
}
