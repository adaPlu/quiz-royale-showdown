package com.rork.quizroyaleshowdown.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.School
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rork.quizroyaleshowdown.data.GameMode
import com.rork.quizroyaleshowdown.data.MODE_INFO
import com.rork.quizroyaleshowdown.data.ModeInfo
import com.rork.quizroyaleshowdown.ui.components.ArenaBackground
import com.rork.quizroyaleshowdown.ui.components.PressableSurface
import com.rork.quizroyaleshowdown.ui.components.TagChip
import com.rork.quizroyaleshowdown.ui.theme.Arena

/** Dedicated top-level play destination used by the persistent app navigation. */
@Composable
fun PlayScreen(onPlay: (GameMode) -> Unit) {
    val haptics = LocalHapticFeedback.current

    ArenaBackground(accent = Arena.Gold) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .systemBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Text(
                text = "PLAY",
                style = MaterialTheme.typography.displayLarge,
                color = Arena.GoldBright,
                fontSize = 38.sp,
                letterSpacing = 3.sp
            )
            Text(
                text = "Choose your arena",
                style = MaterialTheme.typography.titleMedium,
                color = Arena.TextMid
            )

            Spacer(Modifier.height(2.dp))

            PlayModeCard(
                info = MODE_INFO.getValue(GameMode.QUICK),
                accent = Arena.Gold,
                icon = Icons.Filled.Bolt,
                onClick = {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    onPlay(GameMode.QUICK)
                }
            )
            PlayModeCard(
                info = MODE_INFO.getValue(GameMode.TOURNAMENT),
                accent = Arena.Magenta,
                icon = Icons.Filled.EmojiEvents,
                onClick = {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    onPlay(GameMode.TOURNAMENT)
                }
            )
            PlayModeCard(
                info = MODE_INFO.getValue(GameMode.PRACTICE),
                accent = Arena.Cyan,
                icon = Icons.Filled.School,
                onClick = {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    onPlay(GameMode.PRACTICE)
                }
            )

            Text(
                text = "Store, Season and Profile stay one tap away until a match begins.",
                style = MaterialTheme.typography.bodySmall,
                color = Arena.TextLow,
                modifier = Modifier.padding(top = 4.dp)
            )
        }
    }
}

@Composable
private fun PlayModeCard(
    info: ModeInfo,
    accent: Color,
    icon: ImageVector,
    onClick: () -> Unit
) {
    PressableSurface(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, accent.copy(alpha = 0.42f), RoundedCornerShape(20.dp)),
        background = Arena.Surface.copy(alpha = 0.78f),
        borderColor = Color.Transparent,
        shape = RoundedCornerShape(20.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(accent.copy(alpha = 0.035f))
                .padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = accent,
                    modifier = Modifier.size(28.dp)
                )
                Spacer(Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = info.title,
                        style = MaterialTheme.typography.titleLarge,
                        color = Arena.TextHi,
                        fontWeight = FontWeight.W900
                    )
                    Text(
                        text = info.tagline,
                        style = MaterialTheme.typography.bodyMedium,
                        color = accent
                    )
                }
            }

            Text(
                text = info.description,
                style = MaterialTheme.typography.bodyMedium,
                color = Arena.TextMid
            )

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TagChip("${info.rounds} rounds", accent)
                TagChip("${info.maxPlayers} max", accent)
                if (info.lives > 0) TagChip("${info.lives} ${if (info.lives == 1) "life" else "lives"}", accent)
            }
        }
    }
}
