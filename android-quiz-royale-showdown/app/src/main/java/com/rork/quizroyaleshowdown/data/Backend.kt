package com.rork.quizroyaleshowdown.data

import com.rork.quizroyaleshowdown.Config

/** Single source of truth for where the authoritative server lives. */
object Backend {

    /**
     * Read through [Config.allValues] rather than a generated constant so the
     * app still compiles and runs whether or not the env var was inlined.
     */
    val restBaseUrl: String
        get() = requiredUrl("EXPO_PUBLIC_RAILWAY_API_URL")

    val matchHttpBase: String
        get() = requiredUrl("EXPO_PUBLIC_RORK_FUNCTIONS_URL")

    val webSocketBase: String
        get() = matchHttpBase
            .replaceFirst("https://", "wss://")
            .replaceFirst("http://", "ws://")

    private fun requiredUrl(key: String): String =
        Config.allValues[key]
            ?.takeIf { it.isNotBlank() }
            ?.trimEnd('/')
            ?: error("$key is not configured for this build.")
}
