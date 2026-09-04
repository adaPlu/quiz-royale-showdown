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
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.School
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.rork.quizroyaleshowdown.data.GameMode
import com.rork.quizroyaleshowdown.data.MODE_INFO
import com.rork.quizroyaleshowdown.data.MatchDifficulty
import com.rork.quizroyaleshowdown.data.ModeInfo
import com.rork.quizroyaleshowdown.data.PrivateMatchViewModel
import com.rork.quizroyaleshowdown.ui.components.ArenaBackground
import com.rork.quizroyaleshowdown.ui.components.PressableSurface
import com.rork.quizroyaleshowdown.ui.components.TagChip
import com.rork.quizroyaleshowdown.ui.theme.Arena

/** Dedicated top-level play destination used by the persistent app navigation. */
@Composable
fun PlayScreen(
    privateMatchViewModel: PrivateMatchViewModel,
    onPlay: (GameMode) -> Unit,
    onJoinPrivate: (String) -> Unit
) {
    val haptics = LocalHapticFeedback.current
    val privateState by privateMatchViewModel.uiState.collectAsStateWithLifecycle()
    var privateMode by remember { mutableStateOf(GameMode.QUICK) }
    var difficulty by remember { mutableStateOf(MatchDifficulty.MIXED) }
    var joinCode by remember { mutableStateOf("") }

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

            PrivateMatchCard(
                mode = privateMode,
                difficulty = difficulty,
                roomCode = privateState.room?.code,
                busy = privateState.busy,
                errorMessage = privateState.errorMessage,
                joinCode = joinCode,
                onMode = {
                    privateMode = it
                    if (privateState.room != null) privateMatchViewModel.update(it, difficulty)
                },
                onDifficulty = {
                    difficulty = it
                    if (privateState.room != null) privateMatchViewModel.update(privateMode, it)
                },
                onCreate = { privateMatchViewModel.create(privateMode, difficulty) },
                onJoinCode = { joinCode = it.uppercase().filter(Char::isLetterOrDigit).take(6) },
                onJoin = {
                    val code = (privateState.room?.code ?: joinCode).trim()
                    if (code.length == 6) onJoinPrivate(code)
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
private fun PrivateMatchCard(
    mode: GameMode,
    difficulty: MatchDifficulty,
    roomCode: String?,
    busy: Boolean,
    errorMessage: String?,
    joinCode: String,
    onMode: (GameMode) -> Unit,
    onDifficulty: (MatchDifficulty) -> Unit,
    onCreate: () -> Unit,
    onJoinCode: (String) -> Unit,
    onJoin: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, Arena.Violet.copy(alpha = 0.42f), RoundedCornerShape(20.dp))
            .background(Arena.Surface.copy(alpha = 0.78f), RoundedCornerShape(20.dp))
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Lock, contentDescription = null, tint = Arena.Violet, modifier = Modifier.size(26.dp))
            Spacer(Modifier.width(12.dp))
            Column {
                Text("PRIVATE MATCH", color = Arena.TextHi, fontWeight = FontWeight.W900, style = MaterialTheme.typography.titleLarge)
                Text("Create a room or join with a six-character code", color = Arena.Violet, style = MaterialTheme.typography.bodyMedium)
            }
        }

        Text("MODE", color = Arena.TextLow, style = MaterialTheme.typography.labelSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            GameMode.entries.forEach { candidate ->
                SelectChip(candidate.name, candidate == mode, Arena.Gold) { onMode(candidate) }
            }
        }

        Text("DIFFICULTY", color = Arena.TextLow, style = MaterialTheme.typography.labelSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            MatchDifficulty.entries.forEach { candidate ->
                SelectChip(candidate.name, candidate == difficulty, Arena.Violet) { onDifficulty(candidate) }
            }
        }

        if (roomCode == null) {
            PressableSurface(
                onClick = onCreate,
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
                background = Arena.Gold.copy(alpha = 0.14f),
                borderColor = Arena.Gold
            ) {
                Text(if (busy) "CREATING…" else "CREATE PRIVATE ROOM", modifier = Modifier.padding(14.dp), color = Arena.GoldBright, fontWeight = FontWeight.W800)
            }
        } else {
            Text("ROOM CODE", color = Arena.TextLow, style = MaterialTheme.typography.labelSmall)
            Text(roomCode, color = Arena.GoldBright, fontSize = 30.sp, fontWeight = FontWeight.Black, letterSpacing = 5.sp)
            Text("Share this code. Settings remain host-controlled until players enter.", color = Arena.TextMid, style = MaterialTheme.typography.bodySmall)
            PressableSurface(
                onClick = onJoin,
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
                background = Arena.Gold.copy(alpha = 0.14f),
                borderColor = Arena.Gold
            ) {
                Text("ENTER PRIVATE ARENA", modifier = Modifier.padding(14.dp), color = Arena.GoldBright, fontWeight = FontWeight.W800)
            }
        }

        if (roomCode == null) {
            OutlinedTextField(
                value = joinCode,
                onValueChange = onJoinCode,
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                label = { Text("ROOM CODE") },
                placeholder = { Text("AB2CD3") }
            )
            PressableSurface(
                onClick = onJoin,
                enabled = joinCode.length == 6 && !busy,
                modifier = Modifier.fillMaxWidth(),
                background = Arena.Violet.copy(alpha = 0.12f),
                borderColor = Arena.Violet
            ) {
                Text("JOIN BY CODE", modifier = Modifier.padding(14.dp), color = Arena.TextHi, fontWeight = FontWeight.W800)
            }
        }

        if (errorMessage != null) Text(errorMessage, color = Arena.Magenta, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun SelectChip(label: String, selected: Boolean, accent: Color, onClick: () -> Unit) {
    PressableSurface(
        onClick = onClick,
        background = if (selected) accent.copy(alpha = 0.18f) else Arena.SurfaceHi,
        borderColor = if (selected) accent else Arena.Stroke,
        shape = RoundedCornerShape(12.dp)
    ) {
        Text(label, modifier = Modifier.padding(horizontal = 9.dp, vertical = 7.dp), color = if (selected) accent else Arena.TextMid, fontSize = 11.sp, fontWeight = FontWeight.W700)
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
                Icon(imageVector = icon, contentDescription = null, tint = accent, modifier = Modifier.size(28.dp))
                Spacer(Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(text = info.title, style = MaterialTheme.typography.titleLarge, color = Arena.TextHi, fontWeight = FontWeight.W900)
                    Text(text = info.tagline, style = MaterialTheme.typography.bodyMedium, color = accent)
                }
            }
            Text(text = info.description, style = MaterialTheme.typography.bodyMedium, color = Arena.TextMid)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TagChip("${info.rounds} rounds", accent)
                TagChip("${info.maxPlayers} max", accent)
                if (info.lives > 0) TagChip("${info.lives} ${if (info.lives == 1) "life" else "lives"}", accent)
            }
        }
    }
}
