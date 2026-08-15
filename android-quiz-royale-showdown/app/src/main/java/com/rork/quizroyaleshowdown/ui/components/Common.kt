package com.rork.quizroyaleshowdown.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.Spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rork.quizroyaleshowdown.ui.theme.Arena

/**
 * Frame-accurate countdown to [endsAt], corrected by the server clock
 * [offsetMs] so every device shows the same remaining time.
 */
@Composable
fun rememberCountdown(endsAt: Long, offsetMs: Long): State<Long> {
    return produceState(initialValue = remaining(endsAt, offsetMs), endsAt, offsetMs) {
        // Ticks once per frame, then settles at zero until the server pushes
        // the next phase.
        while (true) {
            withFrameMillis { }
            value = remaining(endsAt, offsetMs)
        }
    }
}

private fun remaining(endsAt: Long, offsetMs: Long): Long =
    (endsAt - (System.currentTimeMillis() + offsetMs)).coerceAtLeast(0L)

/** A card that dips slightly under the finger — the app's core tactile cue. */
@Composable
fun PressableSurface(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    shape: RoundedCornerShape = RoundedCornerShape(20.dp),
    background: Color = Arena.Surface,
    borderColor: Color = Arena.Outline,
    borderWidth: Dp = 1.dp,
    content: @Composable BoxScope.() -> Unit
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed && enabled) 0.968f else 1f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium),
        label = "press-scale"
    )
    val animatedBorder by animateColorAsState(borderColor, label = "border")

    Box(
        modifier = modifier
            .scale(scale)
            .clip(shape)
            .background(background)
            .border(borderWidth, animatedBorder, shape)
            .then(
                if (enabled) {
                    Modifier.clickable(
                        interactionSource = interaction,
                        indication = null,
                        onClick = onClick
                    )
                } else {
                    Modifier
                }
            ),
        content = content
    )
}

/** Horizontal drain bar used for the round clock. */
@Composable
fun TimerBar(
    progress: Float,
    modifier: Modifier = Modifier,
    height: Dp = 6.dp
) {
    val clamped = progress.coerceIn(0f, 1f)
    val color = when {
        clamped > 0.5f -> Arena.Cyan
        clamped > 0.22f -> Arena.Gold
        else -> Arena.Magenta
    }
    val animatedColor by animateColorAsState(color, label = "timer-color")

    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(height)
            .clip(RoundedCornerShape(50))
            .background(Arena.SurfaceHi)
    ) {
        Box(
            modifier = Modifier
                .fillMaxHeight()
                .fillMaxWidth(clamped)
                .clip(RoundedCornerShape(50))
                .background(
                    Brush.horizontalGradient(
                        listOf(animatedColor.copy(alpha = 0.7f), animatedColor)
                    )
                )
        )
    }
}

/** Small uppercase label chip used for category, mode and status tags. */
@Composable
fun TagChip(
    text: String,
    color: Color,
    modifier: Modifier = Modifier,
    filled: Boolean = false
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(50))
            .then(
                if (filled) {
                    Modifier.background(color)
                } else {
                    Modifier
                        .background(color.copy(alpha = 0.12f))
                        .border(1.dp, color.copy(alpha = 0.45f), RoundedCornerShape(50))
                }
            )
            .padding(horizontal = 10.dp, vertical = 5.dp)
    ) {
        Text(
            text = text.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = if (filled) Arena.Ink else color,
            letterSpacing = 1.sp,
            fontWeight = FontWeight.W800
        )
    }
}

/** Label + value pair used across lobby and results panels. */
@Composable
fun StatBlock(
    label: String,
    value: String,
    color: Color = Arena.TextHi,
    modifier: Modifier = Modifier
) {
    androidx.compose.foundation.layout.Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp)
    ) {
        Text(
            text = value,
            style = MaterialTheme.typography.titleLarge,
            color = color
        )
        Text(
            text = label.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = Arena.TextLow,
            letterSpacing = 1.sp
        )
    }
}

/** Row of small dots showing how many players have locked in an answer. */
@Composable
fun AnswerProgressDots(
    total: Int,
    answered: Int,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        repeat(total.coerceAtMost(16)) { index ->
            val filled = index < answered
            val color by animateColorAsState(
                targetValue = if (filled) Arena.Cyan else Arena.Outline,
                label = "dot"
            )
            Box(
                modifier = Modifier
                    .size(if (filled) 7.dp else 5.dp)
                    .clip(RoundedCornerShape(50))
                    .background(color)
            )
        }
    }
}
