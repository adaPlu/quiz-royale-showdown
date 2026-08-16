package com.rork.quizroyaleshowdown.data

import com.rork.quizroyaleshowdown.Config

/** Used when no backend URL has been injected into the build config. */
private const val FALLBACK_REST_API = "https://quiz-royale-showdown-api.up.railway.app"
private const val FALLBACK_MATCH_BACKEND = "https://quiz-royale-showdown-backend.rork.app"

/** Single source of truth for where the authoritative server lives. */
object Backend {

    /**
     * Read through [Config.allValues] rather than a generated constant so the
     * app still compiles and runs whether or not the env var was inlined.
     */
    val restBaseUrl: String
        get() = Config.allValues["EXPO_PUBLIC_RAILWAY_API_URL"]
            ?.takeIf { it.isNotBlank() }
            ?.trimEnd('/')
            ?: FALLBACK_REST_API

    val matchHttpBase: String
        get() = Config.allValues["EXPO_PUBLIC_RORK_FUNCTIONS_URL"]
            ?.takeIf { it.isNotBlank() }
            ?.trimEnd('/')
            ?: FALLBACK_MATCH_BACKEND

    val webSocketBase: String
        get() = matchHttpBase
            .replaceFirst("https://", "wss://")
            .replaceFirst("http://", "ws://")
}
