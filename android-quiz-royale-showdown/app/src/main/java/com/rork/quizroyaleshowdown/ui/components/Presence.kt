package com.rork.quizroyaleshowdown.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rork.quizroyaleshowdown.data.PresenceStatus
import com.rork.quizroyaleshowdown.ui.theme.Arena

/** Accent for each presence state: playing reads as gold, idle-online as cyan. */
fun presenceColor(status: PresenceStatus): Color = when (status) {
    PresenceStatus.IN_MATCH -> Arena.GoldBright
    PresenceStatus.ONLINE -> Arena.Cyan
    PresenceStatus.OFFLINE -> Arena.TextLow
}

fun presenceLabel(status: PresenceStatus, matchMode: String?): String = when (status) {
    PresenceStatus.IN_MATCH -> when (matchMode) {
        "QUICK" -> "In a quick match"
        "TOURNAMENT" -> "In a tournament"
        "PRACTICE" -> "In practice"
        else -> "In a match"
    }
    PresenceStatus.ONLINE -> "Online"
    PresenceStatus.OFFLINE -> "Offline"
}

/**
 * Live status dot. Online pulses gently; in-match pulses faster with a halo so
 * it is distinguishable at a glance without reading the label. Offline is a
 * flat, hollow dot so it recedes.
 */
@Composable
fun PresenceDot(
    status: PresenceStatus,
    modifier: Modifier = Modifier,
    size: androidx.compose.ui.unit.Dp = 9.dp
) {
    val color = presenceColor(status)

    if (status == PresenceStatus.OFFLINE) {
        Box(
            modifier = modifier
                .size(size)
                .clip(RoundedCornerShape(50))
                .border(1.5.dp, color.copy(alpha = 0.55f), RoundedCornerShape(50))
        )
        return
    }

    val transition = rememberInfiniteTransition(label = "presence")
    val durationMs = if (status == PresenceStatus.IN_MATCH) 700 else 1_500

    val haloScale by transition.animateFloat(
        initialValue = 1f,
        targetValue = if (status == PresenceStatus.IN_MATCH) 2.4f else 1.9f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMs),
            repeatMode = RepeatMode.Restart
        ),
        label = "halo-scale"
    )
    val haloAlpha by transition.animateFloat(
        initialValue = 0.45f,
        targetValue = 0f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMs),
            repeatMode = RepeatMode.Restart
        ),
        label = "halo-alpha"
    )

    Box(modifier = modifier.size(size), contentAlignment = Alignment.Center) {
        // Expanding ring, drawn behind the solid core.
        Box(
            modifier = Modifier
                .size(size)
                .scale(haloScale)
                .alpha(haloAlpha)
                .clip(RoundedCornerShape(50))
                .background(color)
        )
        Box(
            modifier = Modifier
                .size(size)
                .clip(RoundedCornerShape(50))
                .background(color)
        )
    }
}

/** Dot plus wording, used under a friend's name. */
@Composable
fun PresenceRow(
    status: PresenceStatus,
    matchMode: String?,
    lastSeenAt: Long,
    modifier: Modifier = Modifier
) {
    val color = presenceColor(status)
    val text = when {
        status != PresenceStatus.OFFLINE -> presenceLabel(status, matchMode)
        lastSeenAt > 0L -> "Seen ${relativeTime(lastSeenAt)}"
        else -> "Offline"
    }

    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        PresenceDot(status = status, size = 7.dp)
        Text(
            text = text,
            style = MaterialTheme.typography.labelSmall,
            color = if (status == PresenceStatus.OFFLINE) Arena.TextLow else color,
            fontWeight = if (status == PresenceStatus.IN_MATCH) FontWeight.W700 else FontWeight.W500,
            letterSpacing = 0.4.sp
        )
    }
}

/** Compact "5m ago" style formatting for a last-seen timestamp. */
fun relativeTime(epochMs: Long): String {
    val elapsed = (System.currentTimeMillis() - epochMs).coerceAtLeast(0L)
    val minutes = elapsed / 60_000L
    return when {
        minutes < 1L -> "just now"
        minutes < 60L -> "${minutes}m ago"
        minutes < 60L * 24L -> "${minutes / 60L}h ago"
        else -> "${minutes / (60L * 24L)}d ago"
    }
}
