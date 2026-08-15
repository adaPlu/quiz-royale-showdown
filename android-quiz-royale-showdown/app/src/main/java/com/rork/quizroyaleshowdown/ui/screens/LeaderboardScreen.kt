package com.rork.quizroyaleshowdown.ui.screens

import androidx.compose.animation.animateColorAsState
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.HourglassEmpty
import androidx.compose.material.icons.filled.Public
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.rork.quizroyaleshowdown.data.LeaderboardEntry
import com.rork.quizroyaleshowdown.data.LeaderboardViewModel
import com.rork.quizroyaleshowdown.data.WORLD_BOARD
import com.rork.quizroyaleshowdown.ui.components.ArenaBackground
import com.rork.quizroyaleshowdown.ui.components.PressableSurface
import com.rork.quizroyaleshowdown.ui.components.TagChip
import com.rork.quizroyaleshowdown.ui.theme.Arena

/**
 * World and per-category standings. Guest rows are ranked alongside registered
 * ones but marked as provisional, since a guest id expires when it goes idle.
 */
@Composable
fun LeaderboardScreen(
    viewModel: LeaderboardViewModel,
    onBack: () -> Unit
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    ArenaBackground(accent = Arena.Violet) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .systemBarsPadding()
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .padding(top = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                PressableSurface(
                    onClick = onBack,
                    modifier = Modifier.size(40.dp),
                    background = Arena.Surface.copy(alpha = 0.7f),
                    borderColor = Arena.Outline,
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Icon(
                        imageVector = Icons.Filled.ArrowBack,
                        contentDescription = "Back",
                        tint = Arena.TextMid,
                        modifier = Modifier
                            .align(Alignment.Center)
                            .size(20.dp)
                    )
                }
                Spacer(Modifier.fillMaxWidth(0.04f))
                Column {
                    Text(
                        text = "STANDINGS",
                        style = MaterialTheme.typography.displaySmall,
                        color = Arena.TextHi,
                        fontSize = 20.sp,
                        letterSpacing = 1.5.sp
                    )
                    Text(
                        text = "${state.page?.totalRanked ?: 0} ranked players",
                        style = MaterialTheme.typography.bodySmall,
                        color = Arena.TextLow
                    )
                }
            }

            Spacer(Modifier.height(16.dp))

            LazyRow(
                modifier = Modifier.fillMaxWidth(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 20.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(state.boards, key = { it }) { board ->
                    BoardChip(
                        label = if (board == WORLD_BOARD) "World" else board,
                        selected = state.selectedBoard == board,
                        isWorld = board == WORLD_BOARD,
                        onClick = { viewModel.select(board) }
                    )
                }
            }

            Spacer(Modifier.height(16.dp))

            YourStanding(
                rank = state.page?.yourRank,
                points = state.page?.yourPoints ?: 0,
                board = state.selectedBoard,
                modifier = Modifier.padding(horizontal = 20.dp)
            )

            Spacer(Modifier.height(14.dp))

            when {
                state.loading -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.TopCenter
                ) {
                    CircularProgressIndicator(
                        color = Arena.Gold,
                        strokeWidth = 2.dp,
                        modifier = Modifier
                            .padding(top = 40.dp)
                            .size(28.dp)
                    )
                }

                state.error != null -> EmptyBoard(
                    title = "Standings unavailable",
                    body = state.error.orEmpty()
                )

                state.page?.entries.isNullOrEmpty() -> EmptyBoard(
                    title = "No one ranked yet",
                    body = if (state.selectedBoard == WORLD_BOARD) {
                        "Finish a match to put yourself on the board."
                    } else {
                        "Score points in ${state.selectedBoard} questions to claim this board."
                    }
                )

                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(
                        start = 20.dp,
                        end = 20.dp,
                        bottom = 32.dp
                    ),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(
                        items = state.page?.entries.orEmpty(),
                        key = { "${it.subjectKind}:${it.subjectId}" }
                    ) { entry ->
                        LeaderRow(entry)
                    }
                }
            }
        }
    }
}

@Composable
private fun BoardChip(
    label: String,
    selected: Boolean,
    isWorld: Boolean,
    onClick: () -> Unit
) {
    val accent = if (isWorld) Arena.Gold else Arena.Violet
    val bg by animateColorAsState(
        targetValue = if (selected) accent.copy(alpha = 0.2f) else Arena.Surface.copy(alpha = 0.6f),
        label = "chip-bg"
    )

    PressableSurface(
        onClick = onClick,
        background = bg,
        borderColor = if (selected) accent.copy(alpha = 0.6f) else Arena.Outline,
        shape = RoundedCornerShape(50)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            if (isWorld) {
                Icon(
                    imageVector = Icons.Filled.Public,
                    contentDescription = null,
                    tint = if (selected) accent else Arena.TextLow,
                    modifier = Modifier.size(14.dp)
                )
            }
            Text(
                text = label.uppercase(),
                style = MaterialTheme.typography.labelSmall,
                color = if (selected) accent else Arena.TextMid,
                letterSpacing = 1.sp,
                fontWeight = FontWeight.W800
            )
        }
    }
}

@Composable
private fun YourStanding(
    rank: Int?,
    points: Int,
    board: String,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(
                Brush.horizontalGradient(
                    listOf(Arena.Gold.copy(alpha = 0.16f), Color.Transparent)
                )
            )
            .border(1.dp, Arena.Gold.copy(alpha = 0.35f), RoundedCornerShape(16.dp))
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "YOUR POSITION",
                style = MaterialTheme.typography.labelSmall,
                color = Arena.TextLow,
                letterSpacing = 1.5.sp
            )
            Spacer(Modifier.height(3.dp))
            Text(
                text = if (rank == null) {
                    "Unranked on ${if (board == WORLD_BOARD) "the world board" else board}"
                } else {
                    "#$rank on ${if (board == WORLD_BOARD) "the world board" else board}"
                },
                style = MaterialTheme.typography.titleMedium,
                color = if (rank == null) Arena.TextMid else Arena.GoldBright
            )
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(
                text = points.toString(),
                style = MaterialTheme.typography.titleLarge,
                color = Arena.TextHi
            )
            Text(
                text = "PTS",
                style = MaterialTheme.typography.labelSmall,
                color = Arena.TextLow,
                letterSpacing = 1.sp
            )
        }
    }
}

@Composable
private fun LeaderRow(entry: LeaderboardEntry) {
    val medal = when (entry.rank) {
        1 -> Arena.GoldBright
        2 -> Color(0xFFC9D2E6)
        3 -> Color(0xFFCD7F45)
        else -> Arena.TextLow
    }
    val highlight = entry.isYou

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(
                if (highlight) Arena.Gold.copy(alpha = 0.13f) else Arena.Surface.copy(alpha = 0.65f)
            )
            .border(
                1.dp,
                if (highlight) Arena.Gold.copy(alpha = 0.55f) else Arena.Outline.copy(alpha = 0.6f),
                RoundedCornerShape(14.dp)
            )
            .padding(horizontal = 14.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier.size(30.dp),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = entry.rank.toString(),
                style = MaterialTheme.typography.titleMedium,
                color = medal,
                fontWeight = FontWeight.W900
            )
        }

        Spacer(Modifier.size(10.dp))

        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = entry.displayName,
                    style = MaterialTheme.typography.bodyLarge,
                    color = if (highlight) Arena.GoldBright else Arena.TextHi,
                    fontWeight = FontWeight.W700
                )
                if (highlight) {
                    Spacer(Modifier.size(6.dp))
                    TagChip(text = "you", color = Arena.Gold, filled = true)
                }
            }
            Spacer(Modifier.height(3.dp))
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Text(
                    text = "${entry.wins} ${if (entry.wins == 1) "crown" else "crowns"}",
                    style = MaterialTheme.typography.bodySmall,
                    color = Arena.TextLow
                )
                if (entry.isGuest) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(3.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Filled.HourglassEmpty,
                            contentDescription = null,
                            tint = Arena.Cyan,
                            modifier = Modifier.size(11.dp)
                        )
                        Text(
                            text = "guest — expires when idle",
                            style = MaterialTheme.typography.bodySmall,
                            color = Arena.Cyan
                        )
                    }
                }
            }
        }

        Text(
            text = entry.points.toString(),
            style = MaterialTheme.typography.titleMedium,
            color = if (highlight) Arena.GoldBright else Arena.TextHi
        )
    }
}

@Composable
private fun EmptyBoard(title: String, body: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 32.dp, vertical = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleMedium,
            color = Arena.TextMid,
            textAlign = TextAlign.Center
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = body,
            style = MaterialTheme.typography.bodySmall,
            color = Arena.TextLow,
            textAlign = TextAlign.Center
        )
    }
}
