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
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Diamond
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MilitaryTech
import androidx.compose.material.icons.filled.Public
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rork.quizroyaleshowdown.data.Badge
import com.rork.quizroyaleshowdown.data.BadgeFamily
import com.rork.quizroyaleshowdown.data.PlayerStats
import com.rork.quizroyaleshowdown.data.badgesFor
import com.rork.quizroyaleshowdown.data.badgeShelf
import com.rork.quizroyaleshowdown.data.nextBadge
import com.rork.quizroyaleshowdown.ui.theme.Arena

private fun familyIcon(family: BadgeFamily): ImageVector = when (family) {
    BadgeFamily.WINS -> Icons.Filled.MilitaryTech
    BadgeFamily.RANK -> Icons.Filled.Public
    BadgeFamily.POINTS -> Icons.Filled.Diamond
    BadgeFamily.ACCURACY -> Icons.Filled.Bolt
    BadgeFamily.CROWN -> Icons.Filled.EmojiEvents
}

private fun familyAccent(family: BadgeFamily): Color = when (family) {
    BadgeFamily.WINS -> Arena.Gold
    BadgeFamily.RANK -> Arena.Cyan
    BadgeFamily.POINTS -> Arena.Violet
    BadgeFamily.ACCURACY -> Arena.CyanDeep
    BadgeFamily.CROWN -> Arena.GoldBright
}

/**
 * A single medal. Earned medals get a lit gradient and a slow shimmer; locked
 * ones are hollow and carry a padlock, so the shelf reads as a goal list rather
 * than a wall of identical icons.
 */
@Composable
fun BadgeMedal(
    badge: Badge,
    modifier: Modifier = Modifier,
    size: androidx.compose.ui.unit.Dp = 54.dp
) {
    val accent = familyAccent(badge.family)
    val shape = RoundedCornerShape(percent = 30)

    if (!badge.earned) {
        Box(
            modifier = modifier
                .size(size)
                .clip(shape)
                .background(Arena.Surface.copy(alpha = 0.5f))
                .border(1.dp, Arena.Outline.copy(alpha = 0.7f), shape),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Filled.Lock,
                contentDescription = null,
                tint = Arena.TextLow.copy(alpha = 0.7f),
                modifier = Modifier.size(size * 0.32f)
            )
        }
        return
    }

    // Earned: a slow sheen sweeping across the medal face.
    val transition = rememberInfiniteTransition(label = "medal")
    val sheen by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(2_600),
            repeatMode = RepeatMode.Reverse
        ),
        label = "sheen"
    )

    Box(
        modifier = modifier
            .size(size)
            .clip(shape)
            .background(
                Brush.linearGradient(
                    colors = listOf(
                        accent.copy(alpha = 0.30f + 0.16f * sheen),
                        accent.copy(alpha = 0.10f)
                    )
                )
            )
            .border(1.5.dp, accent.copy(alpha = 0.55f + 0.25f * sheen), shape),
        contentAlignment = Alignment.Center
    ) {
        Icon(
            imageVector = familyIcon(badge.family),
            contentDescription = badge.label,
            tint = accent,
            modifier = Modifier.size(size * 0.46f)
        )
    }
}

/**
 * Compact horizontal shelf of the highest tier earned per family. Shown on the
 * profile header and the home account card.
 */
@Composable
fun BadgeShelf(
    stats: PlayerStats,
    modifier: Modifier = Modifier,
    medalSize: androidx.compose.ui.unit.Dp = 40.dp
) {
    val shelf = remember(stats) { badgeShelf(stats) }
    if (shelf.isEmpty()) return

    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        shelf.forEach { badge ->
            BadgeMedal(badge = badge, size = medalSize)
        }
    }
}

/**
 * The full catalog: earned medals first with their titles, then the locked ones
 * with progress, plus a single "closest goal" nudge underneath.
 */
@Composable
fun BadgeCollection(
    stats: PlayerStats,
    modifier: Modifier = Modifier
) {
    val all = remember(stats) { badgesFor(stats) }
    val earned = remember(all) { all.filter { it.earned } }
    val locked = remember(all) { all.filterNot { it.earned } }
    val next = remember(stats) { nextBadge(stats) }

    Column(modifier = modifier.fillMaxWidth()) {
        if (earned.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(Arena.Surface.copy(alpha = 0.5f))
                    .border(1.dp, Arena.Outline.copy(alpha = 0.6f), RoundedCornerShape(16.dp))
                    .padding(18.dp)
            ) {
                Text(
                    text = "No badges yet. Win a match or climb the world board to earn your first.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Arena.TextMid
                )
            }
        } else {
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 2.dp)
            ) {
                items(earned.size) { index ->
                    val badge = earned[index]
                    Column(
                        modifier = Modifier.width(78.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        BadgeMedal(badge = badge, size = 56.dp)
                        Spacer(Modifier.height(7.dp))
                        Text(
                            text = badge.label,
                            style = MaterialTheme.typography.labelSmall,
                            color = Arena.TextHi,
                            textAlign = TextAlign.Center,
                            fontWeight = FontWeight.W700,
                            lineHeight = 13.sp
                        )
                    }
                }
            }
        }

        if (next != null) {
            Spacer(Modifier.height(16.dp))
            NextBadgeCard(badge = next)
        }

        if (locked.size > 1) {
            Spacer(Modifier.height(14.dp))
            Text(
                text = "LOCKED",
                style = MaterialTheme.typography.labelSmall,
                color = Arena.TextLow,
                letterSpacing = 1.5.sp
            )
            Spacer(Modifier.height(10.dp))
            LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                val remaining = locked.filter { it.id != next?.id }
                items(remaining.size) { index ->
                    val badge = remaining[index]
                    Column(
                        modifier = Modifier.width(78.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        BadgeMedal(badge = badge, size = 48.dp)
                        Spacer(Modifier.height(6.dp))
                        Text(
                            text = badge.label,
                            style = MaterialTheme.typography.labelSmall,
                            color = Arena.TextLow,
                            textAlign = TextAlign.Center,
                            lineHeight = 13.sp
                        )
                    }
                }
            }
        }
    }
}

/** The closest unearned badge, with a progress bar toward it. */
@Composable
private fun NextBadgeCard(badge: Badge) {
    val accent = familyAccent(badge.family)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(
                Brush.horizontalGradient(listOf(accent.copy(alpha = 0.14f), Color.Transparent))
            )
            .border(1.dp, accent.copy(alpha = 0.3f), RoundedCornerShape(16.dp))
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        BadgeMedal(badge = badge, size = 44.dp)
        Spacer(Modifier.width(13.dp))
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "NEXT UP",
                    style = MaterialTheme.typography.labelSmall,
                    color = accent,
                    letterSpacing = 1.4.sp,
                    fontWeight = FontWeight.W800
                )
            }
            Spacer(Modifier.height(3.dp))
            Text(
                text = badge.detail,
                style = MaterialTheme.typography.bodyMedium,
                color = Arena.TextHi
            )
            Spacer(Modifier.height(8.dp))
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(5.dp)
                    .clip(RoundedCornerShape(50))
                    .background(Arena.SurfaceHi)
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth(badge.progress.coerceIn(0.02f, 1f))
                        .height(5.dp)
                        .clip(RoundedCornerShape(50))
                        .background(Brush.horizontalGradient(listOf(accent.copy(alpha = 0.6f), accent)))
                )
            }
            Spacer(Modifier.height(5.dp))
            Text(
                text = badge.progressLabel,
                style = MaterialTheme.typography.labelSmall,
                color = Arena.TextLow
            )
        }
    }
}
