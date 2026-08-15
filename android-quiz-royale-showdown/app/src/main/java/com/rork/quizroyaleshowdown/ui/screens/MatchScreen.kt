package com.rork.quizroyaleshowdown.ui.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material.icons.filled.ContentCut
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.rork.quizroyaleshowdown.data.ConnectionStatus
import com.rork.quizroyaleshowdown.data.GameMode
import com.rork.quizroyaleshowdown.data.MODE_INFO
import com.rork.quizroyaleshowdown.data.MatchViewModel
import com.rork.quizroyaleshowdown.data.Phase
import com.rork.quizroyaleshowdown.data.PowerUp
import com.rork.quizroyaleshowdown.data.PublicMatch
import com.rork.quizroyaleshowdown.data.PublicPlayer
import com.rork.quizroyaleshowdown.data.YouState
import com.rork.quizroyaleshowdown.data.displayName
import com.rork.quizroyaleshowdown.ui.components.ArenaBackground
import com.rork.quizroyaleshowdown.ui.components.PressableSurface
import com.rork.quizroyaleshowdown.ui.components.StatBlock
import com.rork.quizroyaleshowdown.ui.components.TagChip
import com.rork.quizroyaleshowdown.ui.components.TimerBar
import com.rork.quizroyaleshowdown.ui.components.rememberCountdown
import com.rork.quizroyaleshowdown.ui.theme.Arena
import kotlin.math.ceil

@Composable
fun MatchScreen(
    mode: GameMode,
    viewModel: MatchViewModel,
    onExit: () -> Unit
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val haptics = LocalHapticFeedback.current

    LaunchedEffect(mode) { viewModel.startMatch(mode) }

    val match = state.match
    val you = state.you

    // Reveal feedback: a light tap for a correct call, a heavy one for a knockout.
    LaunchedEffect(state.lastRevealedRound, match?.phase) {
        if (match?.phase == Phase.REVEAL && you != null && state.lastRevealedRound > 0) {
            val correct = match.players.firstOrNull { it.id == you.playerId }?.lastAnswerCorrect
            when {
                correct == true -> haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                correct == false -> haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                else -> Unit
            }
        }
    }

    val accent = when {
        match?.phase == Phase.FINISHED && match.winnerId == you?.playerId -> Arena.GoldBright
        you?.alive == false -> Arena.Magenta
        else -> Arena.Gold
    }

    ArenaBackground(accent = accent) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .systemBarsPadding()
        ) {
            MatchTopBar(
                match = match,
                you = you,
                mode = mode,
                onExit = {
                    viewModel.leaveMatch()
                    onExit()
                }
            )

            if (match == null || state.status == ConnectionStatus.MATCHMAKING ||
                state.status == ConnectionStatus.CONNECTING
            ) {
                SearchingPane(status = state.status)
                return@Column
            }

            if (state.status == ConnectionStatus.FAILED) {
                DisconnectedPane(
                    message = state.errorMessage ?: "Connection lost.",
                    onExit = onExit
                )
                return@Column
            }

            val group = when (match.phase) {
                Phase.LOBBY -> "LOBBY"
                Phase.QUESTION, Phase.REVEAL -> "ROUND"
                Phase.FINISHED -> "FINISHED"
            }

            AnimatedContent(
                targetState = group,
                transitionSpec = {
                    (fadeIn(tween(320)) + slideInVertically(tween(320)) { it / 12 })
                        .togetherWith(fadeOut(tween(180)))
                },
                label = "phase"
            ) { current ->
                when (current) {
                    "LOBBY" -> LobbyPane(match = match, clockOffset = state.clockOffsetMs)
                    "ROUND" -> RoundPane(
                        match = match,
                        you = you,
                        clockOffset = state.clockOffsetMs,
                        onAnswer = viewModel::submitAnswer,
                        onPowerUp = viewModel::usePowerUp
                    )
                    else -> ResultsPane(
                        match = match,
                        you = you,
                        onExit = onExit
                    )
                }
            }
        }
    }
}

// ------------------------------------------------------------------ top bar

@Composable
private fun MatchTopBar(
    match: PublicMatch?,
    you: YouState?,
    mode: GameMode,
    onExit: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        PressableSurface(
            onClick = onExit,
            shape = RoundedCornerShape(12.dp),
            background = Arena.Surface.copy(alpha = 0.8f),
            borderColor = Arena.Outline
        ) {
            Icon(
                imageVector = Icons.Filled.Close,
                contentDescription = "Leave match",
                tint = Arena.TextMid,
                modifier = Modifier
                    .padding(8.dp)
                    .size(18.dp)
            )
        }

        Spacer(Modifier.width(12.dp))

        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = if (match != null && match.roundNumber > 0) {
                    "ROUND ${match.roundNumber} / ${match.totalRounds}"
                } else {
                    MODE_INFO.getValue(mode).title
                },
                style = MaterialTheme.typography.labelMedium,
                color = Arena.TextMid,
                letterSpacing = 1.5.sp
            )
            if (match != null && mode != GameMode.PRACTICE) {
                Text(
                    text = "${match.aliveCount} still standing",
                    style = MaterialTheme.typography.bodySmall,
                    color = Arena.TextLow
                )
            }
        }

        if (you != null) {
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    text = you.score.toString(),
                    style = MaterialTheme.typography.titleLarge,
                    color = Arena.GoldBright
                )
                if (you.streak > 1) {
                    Text(
                        text = "${you.streak}x streak",
                        style = MaterialTheme.typography.labelSmall,
                        color = Arena.Cyan
                    )
                } else {
                    Text(
                        text = "points",
                        style = MaterialTheme.typography.labelSmall,
                        color = Arena.TextLow
                    )
                }
            }
        }
    }
}

// ------------------------------------------------------------------ panes

@Composable
private fun SearchingPane(status: ConnectionStatus) {
    val transition = rememberInfiniteTransition(label = "search")
    val ring by transition.animateFloat(
        initialValue = 0.6f,
        targetValue = 1.25f,
        animationSpec = infiniteRepeatable(
            animation = tween(1_500, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "ring"
    )

    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Box(contentAlignment = Alignment.Center) {
            Box(
                modifier = Modifier
                    .size(120.dp)
                    .scale(ring)
                    .clip(RoundedCornerShape(50))
                    .background(Arena.Gold.copy(alpha = 0.10f))
            )
            Icon(
                imageVector = Icons.Filled.Bolt,
                contentDescription = null,
                tint = Arena.Gold,
                modifier = Modifier.size(40.dp)
            )
        }
        Spacer(Modifier.height(24.dp))
        Text(
            text = when (status) {
                ConnectionStatus.MATCHMAKING -> "FINDING AN ARENA"
                else -> "JOINING THE LOBBY"
            },
            style = MaterialTheme.typography.displaySmall,
            color = Arena.TextHi,
            fontSize = 18.sp,
            letterSpacing = 2.sp
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = "Securing your seat on the server",
            style = MaterialTheme.typography.bodyMedium,
            color = Arena.TextLow
        )
    }
}

@Composable
private fun DisconnectedPane(message: String, onExit: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = "SIGNAL LOST",
            style = MaterialTheme.typography.displaySmall,
            color = Arena.Magenta,
            letterSpacing = 2.sp
        )
        Spacer(Modifier.height(10.dp))
        Text(
            text = message,
            style = MaterialTheme.typography.bodyMedium,
            color = Arena.TextMid,
            textAlign = TextAlign.Center
        )
        Spacer(Modifier.height(24.dp))
        PrimaryButton(text = "BACK TO ARENA", accent = Arena.Gold, onClick = onExit)
    }
}

@Composable
private fun LobbyPane(match: PublicMatch, clockOffset: Long) {
    val remaining by rememberCountdown(match.phaseEndsAt, clockOffset)
    val seconds = ceil(remaining / 1000.0).toInt()
    val info = MODE_INFO.getValue(match.mode)
    val progress = (remaining.toFloat() / info.lobbyMs.toFloat()).coerceIn(0f, 1f)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(Modifier.height(20.dp))
        TagChip(text = info.title, color = Arena.Gold)
        Spacer(Modifier.height(24.dp))

        Text(
            text = seconds.coerceAtLeast(0).toString(),
            style = MaterialTheme.typography.displayLarge,
            fontSize = 76.sp,
            color = Arena.GoldBright
        )
        Text(
            text = "MATCH STARTS IN",
            style = MaterialTheme.typography.labelMedium,
            color = Arena.TextLow,
            letterSpacing = 2.sp
        )

        Spacer(Modifier.height(20.dp))
        TimerBar(progress = progress, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(28.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            StatBlock(label = "Challengers", value = match.totalPlayers.toString(), color = Arena.TextHi)
            StatBlock(label = "Rounds", value = info.rounds.toString(), color = Arena.Cyan)
            StatBlock(
                label = "Lives",
                value = if (info.lives > 0) info.lives.toString() else "∞",
                color = Arena.Magenta
            )
        }

        Spacer(Modifier.height(28.dp))
        Text(
            text = "IN THE ARENA",
            style = MaterialTheme.typography.labelMedium,
            color = Arena.TextLow,
            letterSpacing = 2.sp,
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(10.dp))

        LazyColumn(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 24.dp)
        ) {
            items(match.players, key = { it.id }) { player ->
                LobbyPlayerRow(player)
            }
        }
    }
}

@Composable
private fun LobbyPlayerRow(player: PublicPlayer) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Arena.Surface.copy(alpha = 0.7f))
            .border(1.dp, Arena.Outline.copy(alpha = 0.5f), RoundedCornerShape(14.dp))
            .padding(horizontal = 14.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(30.dp)
                .clip(RoundedCornerShape(50))
                .background(avatarColor(player.id).copy(alpha = 0.25f)),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = player.name.take(1).uppercase(),
                style = MaterialTheme.typography.labelLarge,
                color = avatarColor(player.id)
            )
        }
        Spacer(Modifier.width(12.dp))
        Text(
            text = player.name,
            style = MaterialTheme.typography.bodyLarge,
            color = Arena.TextHi,
            modifier = Modifier.weight(1f)
        )
        if (player.isBot) {
            Icon(
                imageVector = Icons.Filled.SmartToy,
                contentDescription = "Rival bot",
                tint = Arena.TextLow,
                modifier = Modifier.size(16.dp)
            )
        }
    }
}

// ------------------------------------------------------------------ round

@Composable
private fun RoundPane(
    match: PublicMatch,
    you: YouState?,
    clockOffset: Long,
    onAnswer: (Int) -> Unit,
    onPowerUp: (PowerUp) -> Unit
) {
    val question = match.question ?: return
    val info = MODE_INFO.getValue(match.mode)
    val revealing = match.phase == Phase.REVEAL
    val remaining by rememberCountdown(match.phaseEndsAt, clockOffset)
    val total = if (revealing) info.revealMs else info.questionMs
    val progress = (remaining.toFloat() / total.toFloat()).coerceIn(0f, 1f)
    val seconds = ceil(remaining / 1000.0).toInt()

    val yourAnswer = you?.answerIndex
    val alive = you?.alive != false
    val answeredCount = match.players.count { it.alive && it.hasAnswered }
    val aliveTotal = match.players.count { it.alive }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
            .padding(bottom = 24.dp)
    ) {
        TimerBar(
            progress = if (revealing) 1f else progress,
            modifier = Modifier.fillMaxWidth(),
            height = 7.dp
        )

        Spacer(Modifier.height(14.dp))

        Row(verticalAlignment = Alignment.CenterVertically) {
            TagChip(text = question.category, color = Arena.Cyan)
            Spacer(Modifier.width(8.dp))
            TagChip(
                text = question.difficulty,
                color = when (question.difficulty) {
                    "hard" -> Arena.Magenta
                    "medium" -> Arena.Gold
                    else -> Arena.TextLow
                }
            )
            Spacer(Modifier.weight(1f))
            if (!revealing) {
                Text(
                    text = "${seconds.coerceAtLeast(0)}s",
                    style = MaterialTheme.typography.titleLarge,
                    color = if (seconds <= 3) Arena.Magenta else Arena.TextHi
                )
            }
        }

        Spacer(Modifier.height(18.dp))

        Text(
            text = question.text,
            style = MaterialTheme.typography.headlineSmall,
            color = Arena.TextHi,
            lineHeight = 30.sp
        )

        Spacer(Modifier.height(20.dp))

        question.options.forEachIndexed { index, option ->
            val removed = you?.removedOptions?.contains(index) == true
            OptionRow(
                index = index,
                text = option,
                selected = yourAnswer == index,
                correct = match.correctIndex == index,
                revealing = revealing,
                removed = removed,
                enabled = alive && !revealing && yourAnswer == null && !removed,
                onClick = { onAnswer(index) }
            )
            Spacer(Modifier.height(10.dp))
        }

        Spacer(Modifier.height(6.dp))

        if (revealing) {
            RevealBanner(match = match, you = you)
        } else {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "$answeredCount / $aliveTotal locked in",
                    style = MaterialTheme.typography.bodySmall,
                    color = Arena.TextLow,
                    modifier = Modifier.weight(1f)
                )
                if (you != null && you.lives > 0 && match.mode != GameMode.PRACTICE) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        repeat(you.lives.coerceAtMost(3)) {
                            Icon(
                                imageVector = Icons.Filled.Favorite,
                                contentDescription = null,
                                tint = Arena.Magenta,
                                modifier = Modifier
                                    .padding(start = 3.dp)
                                    .size(14.dp)
                            )
                        }
                    }
                }
            }

            if (alive && you != null) {
                Spacer(Modifier.height(14.dp))
                PowerUpBar(
                    you = you,
                    locked = yourAnswer != null,
                    onPowerUp = onPowerUp
                )
            }
        }

        if (!alive) {
            Spacer(Modifier.height(16.dp))
            SpectatorBanner(placement = you?.placement)
        }

        Spacer(Modifier.height(18.dp))
        SurvivorRail(players = match.players, youId = you?.playerId, revealing = revealing)
    }
}

@Composable
private fun OptionRow(
    index: Int,
    text: String,
    selected: Boolean,
    correct: Boolean,
    revealing: Boolean,
    removed: Boolean,
    enabled: Boolean,
    onClick: () -> Unit
) {
    val letters = listOf("A", "B", "C", "D", "E", "F")

    val targetBorder = when {
        revealing && correct -> Arena.Cyan
        revealing && selected -> Arena.Magenta
        selected -> Arena.Gold
        else -> Arena.Outline
    }
    val targetBg = when {
        revealing && correct -> Arena.Cyan.copy(alpha = 0.14f)
        revealing && selected -> Arena.Magenta.copy(alpha = 0.14f)
        selected -> Arena.Gold.copy(alpha = 0.12f)
        else -> Arena.Surface.copy(alpha = 0.82f)
    }

    val border by animateColorAsState(targetBorder, tween(280), label = "opt-border")
    val bg by animateColorAsState(targetBg, tween(280), label = "opt-bg")
    val fade by animateFloatAsState(
        targetValue = if (removed) 0.25f else 1f,
        animationSpec = spring(),
        label = "opt-fade"
    )

    PressableSurface(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier
            .fillMaxWidth()
            .alpha(fade),
        background = bg,
        borderColor = border,
        borderWidth = if (selected || (revealing && correct)) 2.dp else 1.dp,
        shape = RoundedCornerShape(16.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 15.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(28.dp)
                    .clip(RoundedCornerShape(9.dp))
                    .background(border.copy(alpha = 0.2f)),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = letters.getOrElse(index) { "?" },
                    style = MaterialTheme.typography.labelLarge,
                    color = border
                )
            }
            Spacer(Modifier.width(12.dp))
            Text(
                text = text,
                style = MaterialTheme.typography.bodyLarge,
                color = if (removed) Arena.TextLow else Arena.TextHi,
                modifier = Modifier.weight(1f)
            )
        }
    }
}

@Composable
private fun PowerUpBar(
    you: YouState,
    locked: Boolean,
    onPowerUp: (PowerUp) -> Unit
) {
    val haptics = LocalHapticFeedback.current
    val all = listOf(PowerUp.FIFTY_FIFTY, PowerUp.SHIELD, PowerUp.DOUBLE_DOWN)

    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        all.forEach { power ->
            val available = you.availablePowerUps.contains(power) && !locked
            val active = when (power) {
                PowerUp.SHIELD -> you.shieldActive
                PowerUp.DOUBLE_DOWN -> you.doubleActive
                PowerUp.FIFTY_FIFTY -> you.removedOptions.isNotEmpty()
            }
            val accent = when (power) {
                PowerUp.FIFTY_FIFTY -> Arena.Cyan
                PowerUp.SHIELD -> Arena.Violet
                PowerUp.DOUBLE_DOWN -> Arena.Magenta
            }

            PressableSurface(
                onClick = {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    onPowerUp(power)
                },
                enabled = available,
                modifier = Modifier.weight(1f),
                background = if (active) accent.copy(alpha = 0.2f) else Arena.Surface.copy(alpha = 0.8f),
                borderColor = if (active) accent else if (available) accent.copy(alpha = 0.4f) else Arena.Outline,
                shape = RoundedCornerShape(14.dp)
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 11.dp)
                        .alpha(if (available || active) 1f else 0.35f),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Icon(
                        imageVector = when (power) {
                            PowerUp.FIFTY_FIFTY -> Icons.Filled.ContentCut
                            PowerUp.SHIELD -> Icons.Filled.Shield
                            PowerUp.DOUBLE_DOWN -> Icons.Filled.Bolt
                        },
                        contentDescription = null,
                        tint = accent,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = power.displayName,
                        style = MaterialTheme.typography.labelSmall,
                        color = if (active) accent else Arena.TextMid
                    )
                }
            }
        }
    }
}

@Composable
private fun RevealBanner(match: PublicMatch, you: YouState?) {
    val me = match.players.firstOrNull { it.id == you?.playerId }
    val correct = me?.lastAnswerCorrect

    val (title, tint) = when {
        match.mode == GameMode.PRACTICE && correct == true -> "CORRECT" to Arena.Cyan
        match.mode == GameMode.PRACTICE -> "NOT QUITE" to Arena.Magenta
        correct == true -> "SURVIVED" to Arena.Cyan
        correct == false && me?.alive == true -> "SAVED" to Arena.Violet
        correct == false -> "KNOCKED OUT" to Arena.Magenta
        else -> "ROUND OVER" to Arena.TextMid
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(tint.copy(alpha = 0.12f))
            .border(1.dp, tint.copy(alpha = 0.5f), RoundedCornerShape(16.dp))
            .padding(16.dp)
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.displaySmall,
            color = tint,
            fontSize = 18.sp,
            letterSpacing = 2.sp
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = if (match.mode == GameMode.PRACTICE) {
                "Score: ${you?.score ?: 0}"
            } else {
                "${match.aliveCount} of ${match.totalPlayers} still standing"
            },
            style = MaterialTheme.typography.bodyMedium,
            color = Arena.TextMid
        )
    }
}

@Composable
private fun SpectatorBanner(placement: Int?) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Arena.Magenta.copy(alpha = 0.10f))
            .border(1.dp, Arena.Magenta.copy(alpha = 0.35f), RoundedCornerShape(14.dp))
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = "ELIMINATED",
            style = MaterialTheme.typography.labelLarge,
            color = Arena.Magenta,
            letterSpacing = 1.5.sp
        )
        Spacer(Modifier.width(10.dp))
        Text(
            text = placement?.let { "Finished #$it — watching the rest play out" }
                ?: "Watching the rest play out",
            style = MaterialTheme.typography.bodySmall,
            color = Arena.TextMid
        )
    }
}

@Composable
private fun SurvivorRail(
    players: List<PublicPlayer>,
    youId: String?,
    revealing: Boolean
) {
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(players, key = { it.id }) { player ->
            val isYou = player.id == youId
            val tint = when {
                !player.alive -> Arena.TextLow
                revealing && player.lastAnswerCorrect == true -> Arena.Cyan
                revealing && player.lastAnswerCorrect == false -> Arena.Magenta
                player.hasAnswered -> Arena.Gold
                else -> Arena.Outline
            }
            val animatedTint by animateColorAsState(tint, tween(300), label = "rail")

            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.width(56.dp)
            ) {
                Box(
                    modifier = Modifier
                        .size(38.dp)
                        .clip(RoundedCornerShape(50))
                        .background(
                            if (player.alive) animatedTint.copy(alpha = 0.18f)
                            else Arena.Surface.copy(alpha = 0.5f)
                        )
                        .border(
                            if (isYou) 2.dp else 1.dp,
                            if (isYou) Arena.GoldBright else animatedTint.copy(alpha = 0.6f),
                            RoundedCornerShape(50)
                        )
                        .alpha(if (player.alive) 1f else 0.4f),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = player.name.take(1).uppercase(),
                        style = MaterialTheme.typography.labelLarge,
                        color = if (player.alive) animatedTint else Arena.TextLow
                    )
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    text = if (isYou) "YOU" else player.name,
                    style = MaterialTheme.typography.labelSmall,
                    color = if (isYou) Arena.GoldBright else Arena.TextLow,
                    maxLines = 1,
                    textAlign = TextAlign.Center
                )
            }
        }
    }
}

// ------------------------------------------------------------------ results

@Composable
private fun ResultsPane(
    match: PublicMatch,
    you: YouState?,
    onExit: () -> Unit
) {
    val won = match.winnerId != null && match.winnerId == you?.playerId
    val transition = rememberInfiniteTransition(label = "results")
    val shimmer by transition.animateFloat(
        initialValue = 0.5f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(1_800, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "shimmer"
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 20.dp)
    ) {
        Spacer(Modifier.height(8.dp))

        Box(
            modifier = Modifier.fillMaxWidth(),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Filled.EmojiEvents,
                contentDescription = null,
                tint = if (won) Arena.GoldBright else Arena.TextLow,
                modifier = Modifier
                    .size(56.dp)
                    .alpha(if (won) shimmer else 0.5f)
            )
        }

        Spacer(Modifier.height(12.dp))

        Text(
            text = when {
                match.mode == GameMode.PRACTICE -> "RUN COMPLETE"
                won -> "VICTORY ROYALE"
                else -> "ELIMINATED"
            },
            style = MaterialTheme.typography.displayMedium.copy(
                brush = if (won) {
                    Brush.horizontalGradient(listOf(Arena.GoldBright, Arena.Gold, Arena.GoldDeep))
                } else null
            ),
            color = if (won) Color.Unspecified else Arena.TextHi,
            modifier = Modifier.fillMaxWidth(),
            textAlign = TextAlign.Center,
            fontSize = 28.sp,
            letterSpacing = 2.sp
        )

        Spacer(Modifier.height(18.dp))

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(18.dp))
                .background(Arena.Surface.copy(alpha = 0.7f))
                .border(1.dp, Arena.Outline, RoundedCornerShape(18.dp))
                .padding(vertical = 16.dp),
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            StatBlock(
                label = "Placement",
                value = you?.placement?.let { "#$it" } ?: "—",
                color = if (won) Arena.GoldBright else Arena.TextHi
            )
            StatBlock(label = "Score", value = (you?.score ?: 0).toString(), color = Arena.Cyan)
            StatBlock(
                label = "Rounds",
                value = "${match.roundNumber}/${match.totalRounds}",
                color = Arena.TextMid
            )
        }

        Spacer(Modifier.height(20.dp))

        Text(
            text = "FINAL STANDINGS",
            style = MaterialTheme.typography.labelMedium,
            color = Arena.TextLow,
            letterSpacing = 2.sp
        )
        Spacer(Modifier.height(10.dp))

        LazyColumn(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            itemsIndexed(match.players, key = { _, p -> p.id }) { index, player ->
                StandingRow(
                    rank = player.placement ?: (index + 1),
                    player = player,
                    isYou = player.id == you?.playerId
                )
            }
        }

        Spacer(Modifier.height(12.dp))
        PrimaryButton(
            text = "BACK TO ARENA",
            accent = if (won) Arena.GoldBright else Arena.Gold,
            onClick = onExit
        )
        Spacer(Modifier.height(20.dp))
    }
}

@Composable
private fun StandingRow(rank: Int, player: PublicPlayer, isYou: Boolean) {
    val accent = when (rank) {
        1 -> Arena.GoldBright
        2 -> Color(0xFFCBD5E1)
        3 -> Color(0xFFCD7F32)
        else -> Arena.TextLow
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(
                if (isYou) Arena.Gold.copy(alpha = 0.10f) else Arena.Surface.copy(alpha = 0.6f)
            )
            .border(
                1.dp,
                if (isYou) Arena.Gold.copy(alpha = 0.5f) else Arena.Outline.copy(alpha = 0.5f),
                RoundedCornerShape(14.dp)
            )
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = "#$rank",
            style = MaterialTheme.typography.titleMedium,
            color = accent,
            modifier = Modifier.width(38.dp)
        )
        Text(
            text = if (isYou) "${player.name} (you)" else player.name,
            style = MaterialTheme.typography.bodyLarge,
            color = Arena.TextHi,
            modifier = Modifier.weight(1f),
            maxLines = 1
        )
        if (player.isBot) {
            Icon(
                imageVector = Icons.Filled.SmartToy,
                contentDescription = null,
                tint = Arena.TextLow,
                modifier = Modifier
                    .padding(end = 8.dp)
                    .size(14.dp)
            )
        }
        Text(
            text = player.score.toString(),
            style = MaterialTheme.typography.titleMedium,
            color = Arena.Cyan
        )
    }
}

@Composable
private fun PrimaryButton(text: String, accent: Color, onClick: () -> Unit) {
    val haptics = LocalHapticFeedback.current
    PressableSurface(
        onClick = {
            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
            onClick()
        },
        modifier = Modifier.fillMaxWidth(),
        background = accent,
        borderColor = accent,
        shape = RoundedCornerShape(16.dp)
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelLarge,
            color = Arena.Ink,
            letterSpacing = 1.5.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 16.dp)
        )
    }
}

private fun avatarColor(id: String): Color {
    val palette = listOf(
        Arena.Gold, Arena.Cyan, Arena.Magenta, Arena.Violet,
        Color(0xFF4ADE80), Color(0xFF38BDF8), Color(0xFFFB923C)
    )
    val index = (id.hashCode().let { if (it < 0) -it else it }) % palette.size
    return palette[index]
}
