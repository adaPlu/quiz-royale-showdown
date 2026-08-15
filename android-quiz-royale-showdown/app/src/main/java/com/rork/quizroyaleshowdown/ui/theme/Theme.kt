package com.rork.quizroyaleshowdown.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

private val ArenaColorScheme = darkColorScheme(
    primary = Arena.Gold,
    onPrimary = Arena.Ink,
    primaryContainer = Arena.GoldDeep,
    onPrimaryContainer = Arena.Ink,
    secondary = Arena.Cyan,
    onSecondary = Arena.Ink,
    tertiary = Arena.Magenta,
    onTertiary = Arena.TextHi,
    background = Arena.Canvas,
    onBackground = Arena.TextHi,
    surface = Arena.Surface,
    onSurface = Arena.TextHi,
    surfaceVariant = Arena.SurfaceHi,
    onSurfaceVariant = Arena.TextMid,
    outline = Arena.Outline,
    error = Arena.Magenta,
    onError = Arena.TextHi
)

/**
 * The app is deliberately dark-only — the arena aesthetic depends on glow
 * against an ink canvas, so there is no light variant and no dynamic color.
 */
@Composable
fun AppTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = ArenaColorScheme,
        typography = ArenaTypography,
        content = content
    )
}
