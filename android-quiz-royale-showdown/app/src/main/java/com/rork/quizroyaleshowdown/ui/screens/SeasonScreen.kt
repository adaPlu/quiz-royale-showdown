package com.rork.quizroyaleshowdown.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.HourglassEmpty
import androidx.compose.material.icons.filled.Stars
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.rork.quizroyaleshowdown.data.Season
import com.rork.quizroyaleshowdown.data.SeasonProgress
import com.rork.quizroyaleshowdown.data.SeasonViewModel
import com.rork.quizroyaleshowdown.ui.components.ArenaBackground
import com.rork.quizroyaleshowdown.ui.components.ArenaOutlineButton
import com.rork.quizroyaleshowdown.ui.components.PressableSurface
import com.rork.quizroyaleshowdown.ui.components.StatBlock
import com.rork.quizroyaleshowdown.ui.components.TagChip
import com.rork.quizroyaleshowdown.ui.theme.Arena
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull

@Composable
fun SeasonScreen(
    viewModel: SeasonViewModel,
    onBack: () -> Unit,
    onRegister: () -> Unit
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    ArenaBackground(accent = Arena.Violet) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .systemBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 28.dp)
        ) {
            SeasonHeader(onBack)
            Spacer(Modifier.height(18.dp))

            if (state.loading) {
                Box(Modifier.fillMaxWidth().padding(vertical = 48.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = Arena.Violet)
                }
                return@Column
            }

            val season = state.season
            val progress = state.progress
            if (season == null || progress == null) {
                ErrorCard(state.error ?: "Season progress is unavailable.")
                Spacer(Modifier.height(12.dp))
                ArenaOutlineButton(text = "Register or sign in", accent = Arena.Gold, onClick = onRegister)
                return@Column
            }

            SeasonSummary(season, progress, state.hasSeasonPass)
            Spacer(Modifier.height(22.dp))
            SectionHeader("Reward track")
            Spacer(Modifier.height(6.dp))
            Text(
                text = "Every level earns 1 seasonal ticket. The milestones below are additional bonuses.",
                style = MaterialTheme.typography.bodySmall,
                color = Arena.TextLow
            )
            Spacer(Modifier.height(10.dp))
            if (season.rewardTrack.isEmpty()) {
                ErrorCard("No season rewards are configured yet.")
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    season.rewardTrack.forEach { reward ->
                        RewardRow(
                            reward = reward,
                            currentLevel = progress.level,
                            hasSeasonPass = state.hasSeasonPass
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SeasonHeader(onBack: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        PressableSurface(
            onClick = onBack,
            modifier = Modifier.size(40.dp),
            background = Arena.Surface.copy(alpha = 0.7f),
            borderColor = Arena.Outline,
            shape = RoundedCornerShape(12.dp)
        ) {
            Icon(Icons.Filled.ArrowBack, contentDescription = "Back", tint = Arena.TextHi)
        }
        Spacer(Modifier.size(14.dp))
        Text(
            text = "SEASON",
            style = MaterialTheme.typography.headlineMedium,
            color = Arena.TextHi,
            fontWeight = FontWeight.W900
        )
    }
}

@Composable
private fun SeasonSummary(season: Season, progress: SeasonProgress, hasSeasonPass: Boolean) {
    val levelProgress = ((progress.xp % 1_000) / 1_000f).coerceIn(0f, 1f)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(Arena.Surface.copy(alpha = 0.74f))
            .padding(16.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.EmojiEvents, contentDescription = null, tint = Arena.Gold, modifier = Modifier.size(34.dp))
            Spacer(Modifier.size(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(season.name, style = MaterialTheme.typography.titleLarge, color = Arena.TextHi, fontWeight = FontWeight.W900)
                Text("Earn XP from matches and wins.", style = MaterialTheme.typography.bodySmall, color = Arena.TextLow)
            }
            TagChip(
                text = if (hasSeasonPass) "pass active" else "free track",
                color = if (hasSeasonPass) Arena.Gold else Arena.TextLow,
                filled = hasSeasonPass
            )
        }
        Spacer(Modifier.height(18.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
            StatBlock("Level", progress.level.toString(), Arena.Gold, Modifier.weight(1f))
            StatBlock("XP", progress.xp.toString(), Arena.Cyan, Modifier.weight(1f))
            StatBlock("Tickets", progress.ticketsEarned.toString(), Arena.Violet, Modifier.weight(1f))
        }
        Spacer(Modifier.height(16.dp))
        LinearProgressIndicator(
            progress = { levelProgress },
            modifier = Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(99.dp)),
            color = Arena.Gold,
            trackColor = Arena.SurfaceHi
        )
    }
}

@Composable
private fun SectionHeader(title: String) {
    Text(
        text = title.uppercase(),
        style = MaterialTheme.typography.labelMedium,
        color = Arena.TextLow,
        fontWeight = FontWeight.W800
    )
}

@Composable
private fun RewardRow(reward: JsonObject, currentLevel: Int, hasSeasonPass: Boolean) {
    val level = (reward["level"] as? JsonPrimitive)?.intOrNull ?: 1
    val premium = (reward["premium"] as? JsonPrimitive)?.booleanOrNull == true
    val reachedLevel = currentLevel >= level
    val unlocked = reachedLevel && (!premium || hasSeasonPass)
    val status = when {
        !reachedLevel -> "level $level"
        premium && !hasSeasonPass -> "pass required"
        else -> "earned"
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Arena.Surface.copy(alpha = 0.68f))
            .padding(14.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                imageVector = if (unlocked) Icons.Filled.Stars else Icons.Filled.HourglassEmpty,
                contentDescription = null,
                tint = if (unlocked) Arena.Gold else Arena.TextLow,
                modifier = Modifier.size(24.dp)
            )
            Spacer(Modifier.size(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text("Level $level", style = MaterialTheme.typography.titleMedium, color = Arena.TextHi, fontWeight = FontWeight.W800)
                if (premium) {
                    Text("Premium milestone", style = MaterialTheme.typography.labelSmall, color = Arena.Gold)
                }
            }
            TagChip(
                text = status,
                color = if (unlocked) Arena.Gold else if (premium) Arena.Violet else Arena.TextLow
            )
        }
        Spacer(Modifier.height(8.dp))
        Text(rewardSummary(reward), style = MaterialTheme.typography.bodySmall, color = Arena.TextMid)
    }
}

@Composable
private fun ErrorCard(text: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Arena.Surface.copy(alpha = 0.7f))
            .padding(14.dp)
    ) {
        Text(text, style = MaterialTheme.typography.bodyMedium, color = Arena.TextHi)
    }
}

private fun rewardSummary(reward: JsonObject): String {
    val parts = buildList {
        (reward["coins"] as? JsonPrimitive)?.intOrNull?.let { add("$it coins") }
        (reward["gems"] as? JsonPrimitive)?.intOrNull?.let { add("$it gems") }
        (reward["seasonalTickets"] as? JsonPrimitive)?.intOrNull?.let { add("$it bonus tickets") }
    }
    return parts.ifEmpty { listOf("Mystery reward") }.joinToString(", ")
}
