package com.rork.quizroyaleshowdown.ui.screens

import androidx.compose.animation.core.LinearEasing
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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.School
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rork.quizroyaleshowdown.data.GameMode
import com.rork.quizroyaleshowdown.data.MODE_INFO
import com.rork.quizroyaleshowdown.data.ModeInfo
import com.rork.quizroyaleshowdown.data.PlayerPrefs
import com.rork.quizroyaleshowdown.ui.components.ArenaBackground
import com.rork.quizroyaleshowdown.ui.components.PressableSurface
import com.rork.quizroyaleshowdown.ui.components.StatBlock
import com.rork.quizroyaleshowdown.ui.components.TagChip
import com.rork.quizroyaleshowdown.ui.theme.Arena
import com.rork.quizroyaleshowdown.ui.theme.DisplayFont

@Composable
fun HomeScreen(
    prefs: PlayerPrefs,
    onPlay: (GameMode) -> Unit
) {
    var name by remember { mutableStateOf(prefs.playerName) }
    var editingName by remember { mutableStateOf(false) }
    val haptics = LocalHapticFeedback.current

    ArenaBackground(accent = Arena.Gold) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .systemBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 32.dp)
        ) {
            Spacer(Modifier.height(28.dp))

            CrownMark()

            Spacer(Modifier.height(18.dp))

            Text(
                text = "QUIZ",
                style = MaterialTheme.typography.displayLarge.copy(
                    brush = Brush.horizontalGradient(
                        listOf(Arena.GoldBright, Arena.Gold, Arena.GoldDeep)
                    )
                ),
                fontSize = 46.sp,
                modifier = Modifier.fillMaxWidth(),
                textAlign = TextAlign.Center,
                letterSpacing = 4.sp
            )
            Text(
                text = "ROYALE",
                style = MaterialTheme.typography.displayLarge.copy(
                    brush = Brush.horizontalGradient(
                        listOf(Arena.GoldBright, Arena.Gold, Arena.GoldDeep)
                    )
                ),
                fontSize = 46.sp,
                modifier = Modifier.fillMaxWidth(),
                textAlign = TextAlign.Center,
                letterSpacing = 4.sp
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = "S H O W D O W N",
                style = MaterialTheme.typography.labelMedium,
                color = Arena.TextMid,
                modifier = Modifier.fillMaxWidth(),
                textAlign = TextAlign.Center,
                letterSpacing = 6.sp
            )

            Spacer(Modifier.height(22.dp))

            NameCard(
                name = name,
                editing = editingName,
                onNameChange = {
                    name = it
                    prefs.playerName = it
                },
                onToggleEdit = {
                    editingName = !editingName
                    if (!editingName && name.isBlank()) {
                        name = prefs.playerName
                    }
                }
            )

            Spacer(Modifier.height(14.dp))

            RecordStrip(prefs)

            Spacer(Modifier.height(24.dp))

            Text(
                text = "CHOOSE YOUR ARENA",
                style = MaterialTheme.typography.labelMedium,
                color = Arena.TextLow,
                letterSpacing = 2.sp
            )

            Spacer(Modifier.height(12.dp))

            ModeCard(
                info = MODE_INFO.getValue(GameMode.QUICK),
                accent = Arena.Gold,
                icon = Icons.Filled.Bolt,
                onClick = {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    onPlay(GameMode.QUICK)
                }
            )
            Spacer(Modifier.height(12.dp))
            ModeCard(
                info = MODE_INFO.getValue(GameMode.TOURNAMENT),
                accent = Arena.Magenta,
                icon = Icons.Filled.EmojiEvents,
                onClick = {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    onPlay(GameMode.TOURNAMENT)
                }
            )
            Spacer(Modifier.height(12.dp))
            ModeCard(
                info = MODE_INFO.getValue(GameMode.PRACTICE),
                accent = Arena.Cyan,
                icon = Icons.Filled.School,
                onClick = {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    onPlay(GameMode.PRACTICE)
                }
            )

            Spacer(Modifier.height(20.dp))
            Text(
                text = "Every answer is scored on the server. No one can fake a win.",
                style = MaterialTheme.typography.bodySmall,
                color = Arena.TextLow,
                modifier = Modifier.fillMaxWidth(),
                textAlign = TextAlign.Center
            )
        }
    }
}

/** Slowly rotating halo behind a crown glyph — the app's signature mark. */
@Composable
private fun CrownMark() {
    val transition = rememberInfiniteTransition(label = "crown")
    val sweep by transition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(9_000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "sweep"
    )
    val glow by transition.animateFloat(
        initialValue = 0.35f,
        targetValue = 0.75f,
        animationSpec = infiniteRepeatable(
            animation = tween(2_400, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "glow"
    )

    Box(
        modifier = Modifier.fillMaxWidth(),
        contentAlignment = Alignment.Center
    ) {
        Box(
            modifier = Modifier
                .size(112.dp)
                .clip(RoundedCornerShape(50))
                .background(
                    Brush.sweepGradient(
                        listOf(
                            Arena.Gold.copy(alpha = 0.0f),
                            Arena.Gold.copy(alpha = glow),
                            Arena.Magenta.copy(alpha = 0.25f),
                            Arena.Gold.copy(alpha = 0.0f)
                        )
                    )
                )
                .alpha(0.9f),
            contentAlignment = Alignment.Center
        ) {
            Box(
                modifier = Modifier
                    .size(96.dp)
                    .clip(RoundedCornerShape(50))
                    .background(Arena.Canvas),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Filled.EmojiEvents,
                    contentDescription = null,
                    tint = Arena.GoldBright,
                    modifier = Modifier
                        .size(46.dp)
                        .alpha(0.6f + sweep / 1200f)
                )
            }
        }
    }
}

@Composable
private fun NameCard(
    name: String,
    editing: Boolean,
    onNameChange: (String) -> Unit,
    onToggleEdit: () -> Unit
) {
    PressableSurface(
        onClick = onToggleEdit,
        modifier = Modifier.fillMaxWidth(),
        background = Arena.Surface.copy(alpha = 0.75f),
        borderColor = if (editing) Arena.Gold else Arena.Outline,
        shape = RoundedCornerShape(18.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 18.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "YOUR CALLSIGN",
                    style = MaterialTheme.typography.labelSmall,
                    color = Arena.TextLow,
                    letterSpacing = 1.5.sp
                )
                Spacer(Modifier.height(4.dp))
                if (editing) {
                    BasicTextField(
                        value = name,
                        onValueChange = { onNameChange(it.take(16)) },
                        singleLine = true,
                        textStyle = LocalTextStyle.current.merge(
                            TextStyle(
                                color = Arena.TextHi,
                                fontSize = 20.sp,
                                fontWeight = FontWeight.W700
                            )
                        ),
                        cursorBrush = SolidColor(Arena.Gold),
                        modifier = Modifier.fillMaxWidth()
                    )
                } else {
                    Text(
                        text = name,
                        style = MaterialTheme.typography.headlineSmall,
                        color = Arena.TextHi
                    )
                }
            }
            Icon(
                imageVector = Icons.Filled.Edit,
                contentDescription = if (editing) "Save callsign" else "Edit callsign",
                tint = if (editing) Arena.Gold else Arena.TextLow,
                modifier = Modifier.size(20.dp)
            )
        }
    }
}

@Composable
private fun RecordStrip(prefs: PlayerPrefs) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(Arena.Surface.copy(alpha = 0.55f))
            .border(1.dp, Arena.Outline.copy(alpha = 0.6f), RoundedCornerShape(18.dp))
            .padding(vertical = 14.dp),
        horizontalArrangement = Arrangement.SpaceEvenly
    ) {
        StatBlock(
            label = "Crowns",
            value = prefs.wins.toString(),
            color = Arena.GoldBright
        )
        VerticalDivider()
        StatBlock(
            label = "Best Place",
            value = prefs.bestPlacement.let { if (it == 0) "—" else "#$it" },
            color = Arena.Cyan
        )
        VerticalDivider()
        StatBlock(
            label = "Best Score",
            value = prefs.bestScore.toString(),
            color = Arena.TextHi
        )
    }
}

@Composable
private fun VerticalDivider() {
    Box(
        modifier = Modifier
            .width(1.dp)
            .height(34.dp)
            .background(Arena.Outline.copy(alpha = 0.6f))
    )
}

@Composable
private fun ModeCard(
    info: ModeInfo,
    accent: Color,
    icon: ImageVector,
    onClick: () -> Unit
) {
    PressableSurface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        background = Arena.Surface,
        borderColor = accent.copy(alpha = 0.35f),
        shape = RoundedCornerShape(22.dp)
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .background(
                    Brush.horizontalGradient(
                        listOf(accent.copy(alpha = 0.16f), Color.Transparent)
                    )
                )
        ) {
            Column(modifier = Modifier.padding(18.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(44.dp)
                            .clip(RoundedCornerShape(14.dp))
                            .background(accent.copy(alpha = 0.18f)),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = icon,
                            contentDescription = null,
                            tint = accent,
                            modifier = Modifier.size(24.dp)
                        )
                    }
                    Spacer(Modifier.width(14.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = info.title,
                            style = MaterialTheme.typography.displaySmall,
                            color = Arena.TextHi,
                            fontSize = 18.sp,
                            letterSpacing = 1.sp
                        )
                        Spacer(Modifier.height(2.dp))
                        Text(
                            text = info.tagline,
                            style = MaterialTheme.typography.bodySmall,
                            color = accent
                        )
                    }
                }

                Spacer(Modifier.height(12.dp))

                Text(
                    text = info.description,
                    style = MaterialTheme.typography.bodyMedium,
                    color = Arena.TextMid
                )

                Spacer(Modifier.height(14.dp))

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TagChip(text = "${info.rounds} rounds", color = Arena.TextLow)
                    if (info.lives > 0) {
                        TagChip(
                            text = if (info.lives == 1) "1 life" else "${info.lives} lives",
                            color = Arena.Magenta
                        )
                    } else {
                        TagChip(text = "no knockout", color = Arena.Cyan)
                    }
                    if (info.maxPlayers > 1) {
                        TagChip(text = "up to ${info.maxPlayers}", color = Arena.TextLow)
                    } else {
                        TagChip(text = "solo", color = Arena.TextLow)
                    }
                }
            }
        }
    }
}
