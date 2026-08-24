package com.rork.quizroyaleshowdown.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.rork.quizroyaleshowdown.data.GameMode
import com.rork.quizroyaleshowdown.ui.components.ArenaBackground
import com.rork.quizroyaleshowdown.ui.components.PressableSurface
import com.rork.quizroyaleshowdown.ui.components.TagChip
import com.rork.quizroyaleshowdown.ui.theme.Arena

@Composable
fun PlayScreen(onPlay: (GameMode) -> Unit) {
    ArenaBackground(accent = Arena.Gold) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .systemBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 28.dp)
        ) {
            Spacer(Modifier.height(20.dp))
            Text(
                text = "PLAY",
                style = MaterialTheme.typography.headlineLarge,
                color = Arena.TextHi,
                fontWeight = FontWeight.W900
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = "Choose a mode and enter the arena.",
                style = MaterialTheme.typography.bodyMedium,
                color = Arena.TextLow
            )
            Spacer(Modifier.height(22.dp))

            ModeEntry(
                title = "Quick Match",
                subtitle = "Fast multiplayer trivia with a short lobby.",
                tag = "QUICK",
                icon = Icons.Filled.Bolt,
                accent = Arena.Gold,
                onClick = { onPlay(GameMode.QUICK) }
            )
            Spacer(Modifier.height(12.dp))
            ModeEntry(
                title = "Tournament",
                subtitle = "Longer elimination format with higher stakes.",
                tag = "TOURNAMENT",
                icon = Icons.Filled.EmojiEvents,
                accent = Arena.Magenta,
                onClick = { onPlay(GameMode.TOURNAMENT) }
            )
            Spacer(Modifier.height(12.dp))
            ModeEntry(
                title = "Practice",
                subtitle = "Solo practice without a shared multiplayer lobby.",
                tag = "PRACTICE",
                icon = Icons.Filled.School,
                accent = Arena.Cyan,
                onClick = { onPlay(GameMode.PRACTICE) }
            )
        }
    }
}

@Composable
private fun ModeEntry(
    title: String,
    subtitle: String,
    tag: String,
    icon: ImageVector,
    accent: Color,
    onClick: () -> Unit
) {
    PressableSurface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        background = Arena.Surface.copy(alpha = 0.72f),
        borderColor = accent.copy(alpha = 0.5f),
        shape = RoundedCornerShape(18.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Column(
                modifier = Modifier
                    .size(46.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(accent.copy(alpha = 0.16f)),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                Icon(icon, contentDescription = null, tint = accent, modifier = Modifier.size(24.dp))
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium,
                    color = Arena.TextHi,
                    fontWeight = FontWeight.W800
                )
                Spacer(Modifier.height(3.dp))
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = Arena.TextLow
                )
                Spacer(Modifier.height(8.dp))
                TagChip(text = tag, color = accent)
            }
        }
    }
}
