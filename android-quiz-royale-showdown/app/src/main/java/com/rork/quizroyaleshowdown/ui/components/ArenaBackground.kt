package com.rork.quizroyaleshowdown.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import com.rork.quizroyaleshowdown.ui.theme.Arena
import kotlin.math.cos
import kotlin.math.sin

/**
 * The shared atmosphere for every screen: an ink canvas with two slowly
 * drifting light pools tinted by [accent], plus a soft floor glow. Gives depth
 * without competing with the foreground content.
 */
@Composable
fun ArenaBackground(
    accent: Color = Arena.Gold,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit
) {
    val transition = rememberInfiniteTransition(label = "arena-bg")
    val drift by transition.animateFloat(
        initialValue = 0f,
        targetValue = (2f * Math.PI).toFloat(),
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 18_000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "drift"
    )
    val pulse by transition.animateFloat(
        initialValue = 0.82f,
        targetValue = 1.12f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 6_500, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulse"
    )

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(Arena.Canvas, Arena.Ink, Color(0xFF05070D))
                )
            )
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val w = size.width
            val h = size.height

            // Primary accent pool, drifting near the top third.
            val p1 = Offset(
                x = w * (0.30f + 0.14f * cos(drift)),
                y = h * (0.20f + 0.06f * sin(drift))
            )
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(accent.copy(alpha = 0.26f), Color.Transparent),
                    center = p1,
                    radius = w * 0.85f * pulse
                ),
                radius = w * 0.85f * pulse,
                center = p1
            )

            // Cool counter-pool, drifting the other way for colour separation.
            val p2 = Offset(
                x = w * (0.76f - 0.16f * sin(drift * 0.8f)),
                y = h * (0.62f + 0.09f * cos(drift * 0.8f))
            )
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(Arena.Violet.copy(alpha = 0.20f), Color.Transparent),
                    center = p2,
                    radius = w * 0.72f
                ),
                radius = w * 0.72f,
                center = p2
            )

            // Floor glow anchors the composition.
            drawRect(
                brush = Brush.verticalGradient(
                    colors = listOf(Color.Transparent, Arena.Ink.copy(alpha = 0.85f)),
                    startY = h * 0.55f,
                    endY = h
                )
            )
        }
        content()
    }
}
