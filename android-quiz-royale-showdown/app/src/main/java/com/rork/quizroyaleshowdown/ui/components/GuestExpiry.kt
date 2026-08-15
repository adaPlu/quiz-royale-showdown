package com.rork.quizroyaleshowdown.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.HourglassBottom
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rork.quizroyaleshowdown.data.ExpiryLevel
import com.rork.quizroyaleshowdown.data.GuestExpiryState
import com.rork.quizroyaleshowdown.ui.theme.Arena

private fun levelColor(level: ExpiryLevel): Color = when (level) {
    ExpiryLevel.SAFE -> Arena.Cyan
    ExpiryLevel.WARNING -> Arena.Gold
    ExpiryLevel.CRITICAL, ExpiryLevel.LAPSED -> Arena.Magenta
}

/**
 * Always-on, deliberately quiet countdown chip for the guest session. Sits with
 * the identity label so the player can always see how long the temporary id has
 * left, without being nagged about it.
 */
@Composable
fun GuestSessionChip(
    expiry: GuestExpiryState,
    modifier: Modifier = Modifier
) {
    val color by animateColorAsState(levelColor(expiry.level), label = "chip-color")

    Row(
        modifier = modifier
            .clip(RoundedCornerShape(50))
            .background(color.copy(alpha = 0.12f))
            .border(1.dp, color.copy(alpha = 0.4f), RoundedCornerShape(50))
            .padding(horizontal = 9.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp)
    ) {
        Icon(
            imageVector = Icons.Filled.Timer,
            contentDescription = null,
            tint = color,
            modifier = Modifier.size(11.dp)
        )
        Text(
            text = "${expiry.mmss} left",
            style = MaterialTheme.typography.labelSmall,
            color = color,
            fontWeight = FontWeight.W700,
            letterSpacing = 0.5.sp
        )
    }
}

/**
 * The escalating warning. Hidden entirely while the session is healthy, slides
 * in as the idle limit approaches, and turns urgent with a pulse in the last
 * minute. Both ways out are offered: stay as a guest, or make it permanent.
 */
@Composable
fun GuestExpiryWarning(
    expiry: GuestExpiryState?,
    onExtend: () -> Unit,
    onRegister: () -> Unit,
    modifier: Modifier = Modifier
) {
    val visible = expiry != null &&
        (expiry.level == ExpiryLevel.WARNING || expiry.level == ExpiryLevel.CRITICAL)

    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(tween(240)) + expandVertically(tween(260)),
        exit = fadeOut(tween(180)) + shrinkVertically(tween(200)),
        modifier = modifier
    ) {
        // Keep rendering the last known values through the exit animation.
        val shown = expiry ?: return@AnimatedVisibility
        WarningCard(expiry = shown, onExtend = onExtend, onRegister = onRegister)
    }
}

@Composable
private fun WarningCard(
    expiry: GuestExpiryState,
    onExtend: () -> Unit,
    onRegister: () -> Unit
) {
    val critical = expiry.level == ExpiryLevel.CRITICAL
    val color by animateColorAsState(levelColor(expiry.level), label = "warn-color")

    // Only the final minute pulses — earlier escalation would cry wolf.
    val transition = rememberInfiniteTransition(label = "warn-pulse")
    val pulse by transition.animateFloat(
        initialValue = 1f,
        targetValue = if (critical) 1.03f else 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(620),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulse"
    )
    val glow by transition.animateFloat(
        initialValue = 0.22f,
        targetValue = if (critical) 0.42f else 0.22f,
        animationSpec = infiniteRepeatable(
            animation = tween(620),
            repeatMode = RepeatMode.Reverse
        ),
        label = "glow"
    )

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .scale(if (critical) pulse else 1f)
            .clip(RoundedCornerShape(18.dp))
            .background(
                Brush.horizontalGradient(
                    listOf(color.copy(alpha = glow), color.copy(alpha = 0.06f))
                )
            )
            .border(1.dp, color.copy(alpha = 0.5f), RoundedCornerShape(18.dp))
            .padding(15.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(34.dp)
                    .clip(RoundedCornerShape(11.dp))
                    .background(color.copy(alpha = 0.2f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Filled.HourglassBottom,
                    contentDescription = null,
                    tint = color,
                    modifier = Modifier.size(18.dp)
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = if (critical) {
                        "Guest session ending"
                    } else {
                        "Guest session idle"
                    },
                    style = MaterialTheme.typography.titleSmall,
                    color = Arena.TextHi,
                    fontWeight = FontWeight.W800
                )
                Text(
                    text = "Your run resets in ${expiry.mmss}",
                    style = MaterialTheme.typography.bodySmall,
                    color = color
                )
            }
            Text(
                text = expiry.mmss,
                style = MaterialTheme.typography.headlineSmall,
                color = color,
                fontWeight = FontWeight.W800
            )
        }

        Spacer(Modifier.height(12.dp))

        // Drain bar across the full 30-minute window, so the shrinking sliver
        // itself communicates urgency before any text is read.
        val fraction by animateFloatAsState(expiry.fraction, label = "drain")
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(5.dp)
                .clip(RoundedCornerShape(50))
                .background(Arena.SurfaceHi)
        ) {
            Box(
                modifier = Modifier
                    .fillMaxHeight()
                    .fillMaxWidth(fraction.coerceIn(0.01f, 1f))
                    .clip(RoundedCornerShape(50))
                    .background(Brush.horizontalGradient(listOf(color.copy(alpha = 0.55f), color)))
            )
        }

        Spacer(Modifier.height(13.dp))

        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            PressableSurface(
                onClick = onExtend,
                modifier = Modifier
                    .weight(1f)
                    .height(42.dp),
                background = Arena.Surface.copy(alpha = 0.8f),
                borderColor = color.copy(alpha = 0.45f),
                shape = RoundedCornerShape(12.dp)
            ) {
                Text(
                    text = "Stay in",
                    style = MaterialTheme.typography.labelLarge,
                    color = Arena.TextHi,
                    modifier = Modifier.align(Alignment.Center)
                )
            }
            PressableSurface(
                onClick = onRegister,
                modifier = Modifier
                    .weight(1.35f)
                    .height(42.dp),
                background = Color.Transparent,
                borderColor = Color.Transparent,
                shape = RoundedCornerShape(12.dp)
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .fillMaxHeight()
                        .clip(RoundedCornerShape(12.dp))
                        .background(
                            Brush.horizontalGradient(listOf(Arena.GoldDeep, Arena.GoldBright))
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "Keep it forever",
                        style = MaterialTheme.typography.labelLarge,
                        color = Arena.Ink,
                        fontWeight = FontWeight.W800
                    )
                }
            }
        }
    }
}
