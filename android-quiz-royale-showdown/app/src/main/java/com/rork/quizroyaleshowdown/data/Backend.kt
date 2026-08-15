package com.rork.quizroyaleshowdown.data

import com.rork.quizroyaleshowdown.Config

/** Used when no functions URL has been injected into the build config. */
private const val FALLBACK_BACKEND = "https://quiz-royale-showdown-backend.rork.app"

/** Single source of truth for where the authoritative server lives. */
object Backend {

    /**
     * Read through [Config.allValues] rather than a generated constant so the
     * app still compiles and runs whether or not the env var was inlined.
     */
    val baseUrl: String
        get() = Config.allValues["EXPO_PUBLIC_RORK_FUNCTIONS_URL"]
            ?.takeIf { it.isNotBlank() }
            ?.trimEnd('/')
            ?: FALLBACK_BACKEND

    val webSocketBase: String
        get() = baseUrl
            .replaceFirst("https://", "wss://")
            .replaceFirst("http://", "ws://")
}
