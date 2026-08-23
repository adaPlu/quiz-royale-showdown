package com.rork.quizroyaleshowdown.ui.screens

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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.HourglassEmpty
import androidx.compose.material.icons.filled.PersonRemove
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.rork.quizroyaleshowdown.data.AuthViewModel
import com.rork.quizroyaleshowdown.data.Friend
import com.rork.quizroyaleshowdown.data.GuestExpiryState
import com.rork.quizroyaleshowdown.data.Identity
import com.rork.quizroyaleshowdown.data.PlayerStats
import com.rork.quizroyaleshowdown.data.PresenceStatus
import com.rork.quizroyaleshowdown.ui.components.ArenaBackground
import com.rork.quizroyaleshowdown.ui.components.ArenaBanner
import com.rork.quizroyaleshowdown.ui.components.ArenaButton
import com.rork.quizroyaleshowdown.ui.components.ArenaOutlineButton
import com.rork.quizroyaleshowdown.ui.components.ArenaTextField
import com.rork.quizroyaleshowdown.ui.components.BadgeCollection
import com.rork.quizroyaleshowdown.ui.components.GuestExpiryWarning
import com.rork.quizroyaleshowdown.ui.components.GuestSessionChip
import com.rork.quizroyaleshowdown.ui.components.PresenceDot
import com.rork.quizroyaleshowdown.ui.components.PresenceRow
import com.rork.quizroyaleshowdown.ui.components.PressableSurface
import com.rork.quizroyaleshowdown.ui.components.StatBlock
import com.rork.quizroyaleshowdown.ui.components.TagChip
import com.rork.quizroyaleshowdown.ui.theme.Arena

/**
 * The player's record. A guest sees exactly the counters a temporary id tracks
 * plus a prompt to make it permanent; a registered player additionally gets a
 * friends list and an explicit "stats are saved" guarantee.
 */
@Composable
fun ProfileScreen(
    viewModel: AuthViewModel,
    onBack: () -> Unit,
    onRegister: () -> Unit
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val expiry by viewModel.guestExpiry.collectAsStateWithLifecycle()
    val identity = state.identity
    val stats = identity.stats ?: PlayerStats()
    var friendName by remember { mutableStateOf("") }

    val accent = if (identity.isRegistered) Arena.Gold else Arena.Cyan

    // Pull fresh presence the moment the list is on screen rather than waiting
    // for the next background ping.
    LaunchedEffect(identity.isRegistered) {
        if (identity.isRegistered) viewModel.refreshFriends()
    }

    ArenaBackground(accent = accent) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .systemBarsPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 32.dp)
        ) {
            Spacer(Modifier.height(12.dp))

            Row(verticalAlignment = Alignment.CenterVertically) {
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
                Spacer(Modifier.width(14.dp))
                Text(
                    text = "YOUR RECORD",
                    style = MaterialTheme.typography.displaySmall,
                    color = Arena.TextHi,
                    fontSize = 20.sp,
                    letterSpacing = 1.5.sp
                )
            }

            Spacer(Modifier.height(20.dp))

            IdentityCard(identity = identity, accent = accent, expiry = expiry)

            if (identity is Identity.Guest) {
                Spacer(Modifier.height(14.dp))
                GuestExpiryWarning(
                    expiry = expiry,
                    onExtend = { viewModel.extendGuestSession() },
                    onRegister = onRegister
                )
            }

            if (state.notice != null) {
                Spacer(Modifier.height(14.dp))
                ArenaBanner(message = state.notice.orEmpty(), isError = false)
            }
            if (state.error != null) {
                Spacer(Modifier.height(14.dp))
                ArenaBanner(message = state.error.orEmpty(), isError = true)
            }

            Spacer(Modifier.height(20.dp))

            SectionHeader("Career")
            Spacer(Modifier.height(10.dp))

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(18.dp))
                    .background(Arena.Surface.copy(alpha = 0.6f))
                    .border(1.dp, Arena.Outline.copy(alpha = 0.6f), RoundedCornerShape(18.dp))
                    .padding(vertical = 16.dp),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                StatBlock(label = "Wins", value = stats.wins.toString(), color = Arena.GoldBright)
                Divider()
                StatBlock(label = "Losses", value = stats.losses.toString(), color = Arena.Magenta)
                Divider()
                StatBlock(
                    label = "Total Points",
                    value = stats.totalPoints.toString(),
                    color = Arena.TextHi
                )
            }

            Spacer(Modifier.height(10.dp))

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(18.dp))
                    .background(Arena.Surface.copy(alpha = 0.6f))
                    .border(1.dp, Arena.Outline.copy(alpha = 0.6f), RoundedCornerShape(18.dp))
                    .padding(vertical = 16.dp),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                StatBlock(
                    label = "Best Place",
                    value = stats.bestPlacement?.let { "#$it" } ?: "—",
                    color = Arena.Cyan
                )
                Divider()
                StatBlock(label = "Best Score", value = stats.bestScore.toString())
                Divider()
                StatBlock(
                    label = "Matches",
                    value = stats.matchesPlayed.toString(),
                    color = Arena.TextMid
                )
            }

            Spacer(Modifier.height(20.dp))

            SectionHeader("Power-ups")
            Spacer(Modifier.height(10.dp))
            PowerUpCard(charges = stats.powerUpCharges, used = stats.powerUpsUsed)

            Spacer(Modifier.height(22.dp))

            SectionHeader(
                title = "Badges",
                trailing = stats.bestRank?.let { "best rank #$it" }
            )
            Spacer(Modifier.height(12.dp))
            BadgeCollection(stats = stats)

            if (stats.categoryPoints.isNotEmpty()) {
                Spacer(Modifier.height(22.dp))
                SectionHeader("Category mastery")
                Spacer(Modifier.height(10.dp))
                CategoryBreakdown(stats.categoryPoints)
            }

            Spacer(Modifier.height(24.dp))

            when (identity) {
                is Identity.Registered -> {
                    val friends = state.friends
                    val activeCount = friends.count { it.status != PresenceStatus.OFFLINE }
                    SectionHeader(
                        title = "Friends",
                        trailing = if (friends.isEmpty()) {
                            "0"
                        } else {
                            "$activeCount of ${friends.size} active"
                        }
                    )
                    Spacer(Modifier.height(10.dp))

                    ArenaTextField(
                        label = "Add by username",
                        value = friendName,
                        onValueChange = { friendName = it },
                        placeholder = "Their exact username",
                        enabled = !state.busy,
                        maxLength = 16,
                        imeAction = ImeAction.Done
                    )
                    Spacer(Modifier.height(10.dp))
                    ArenaOutlineButton(
                        text = "Add friend",
                        accent = Arena.Cyan,
                        enabled = friendName.isNotBlank() && !state.busy,
                        onClick = {
                            viewModel.addFriend(friendName)
                            friendName = ""
                        }
                    )

                    Spacer(Modifier.height(14.dp))

                    if (friends.isEmpty()) {
                        Text(
                            text = "No friends yet. Add someone by username to compare records.",
                            style = MaterialTheme.typography.bodySmall,
                            color = Arena.TextLow
                        )
                    } else {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            friends.forEach { friend ->
                                FriendRow(
                                    friend = friend,
                                    busy = state.busy,
                                    onRemove = {
                                        viewModel.removeFriend(friend.userId, friend.username)
                                    }
                                )
                            }
                        }
                    }

                    Spacer(Modifier.height(26.dp))
                    ArenaOutlineButton(
                        text = "Sign out",
                        accent = Arena.Magenta,
                        onClick = { viewModel.logout() }
                    )
                }

                is Identity.Guest -> {
                    GuestLimitsCard()
                    Spacer(Modifier.height(16.dp))
                    ArenaButton(text = "Register to keep this", onClick = onRegister)
                }

                Identity.Unknown -> Unit
            }
        }
    }
}

@Composable
private fun IdentityCard(identity: Identity, accent: Color, expiry: GuestExpiryState?) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(
                Brush.horizontalGradient(listOf(accent.copy(alpha = 0.18f), Color.Transparent))
            )
            .border(1.dp, accent.copy(alpha = 0.4f), RoundedCornerShape(20.dp))
            .padding(18.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = identity.displayName,
                style = MaterialTheme.typography.headlineSmall,
                color = Arena.TextHi,
                modifier = Modifier.weight(1f)
            )
            TagChip(
                text = if (identity.isRegistered) "registered" else "guest",
                color = accent,
                filled = true
            )
        }

        Spacer(Modifier.height(8.dp))

        when (identity) {
            is Identity.Registered -> {
                Text(
                    text = identity.profile.email,
                    style = MaterialTheme.typography.bodySmall,
                    color = Arena.TextMid
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    text = "Stats are saved to your account and persist across sessions.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Arena.TextLow
                )
            }

            is Identity.Guest -> {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        imageVector = Icons.Filled.HourglassEmpty,
                        contentDescription = null,
                        tint = Arena.Cyan,
                        modifier = Modifier.size(13.dp)
                    )
                    Text(
                        text = "Temporary guest session",
                        style = MaterialTheme.typography.bodySmall,
                        color = Arena.Cyan
                    )
                    if (expiry != null) {
                        GuestSessionChip(expiry = expiry)
                    }
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    text = "This id is recycled once you go idle, and its stats go with it.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Arena.TextLow
                )
            }

            Identity.Unknown -> Text(
                text = "Setting up your session…",
                style = MaterialTheme.typography.bodySmall,
                color = Arena.TextLow
            )
        }
    }
}

@Composable
private fun GuestLimitsCard() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Arena.Surface.copy(alpha = 0.55f))
            .border(1.dp, Arena.Outline.copy(alpha = 0.6f), RoundedCornerShape(16.dp))
            .padding(16.dp)
    ) {
        Text(
            text = "GUEST LIMITS",
            style = MaterialTheme.typography.labelSmall,
            color = Arena.TextLow,
            letterSpacing = 1.5.sp
        )
        Spacer(Modifier.height(10.dp))
        listOf(
            "Your run is tracked while you play, including leaderboard spots.",
            "No friends list and no permanent identity.",
            "Everything resets once the id expires from inactivity."
        ).forEach { line ->
            Row(modifier = Modifier.padding(bottom = 6.dp)) {
                Text(text = "•  ", style = MaterialTheme.typography.bodySmall, color = Arena.Magenta)
                Text(
                    text = line,
                    style = MaterialTheme.typography.bodySmall,
                    color = Arena.TextMid
                )
            }
        }
    }
}

@Composable
private fun PowerUpCard(charges: Int, used: Int) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(
                Brush.horizontalGradient(listOf(Arena.Violet.copy(alpha = 0.18f), Color.Transparent))
            )
            .border(1.dp, Arena.Violet.copy(alpha = 0.35f), RoundedCornerShape(16.dp))
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(40.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(Arena.Violet.copy(alpha = 0.2f)),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Filled.Bolt,
                contentDescription = null,
                tint = Arena.Violet,
                modifier = Modifier.size(22.dp)
            )
        }
        Spacer(Modifier.width(14.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "$charges charges banked",
                style = MaterialTheme.typography.titleMedium,
                color = Arena.TextHi
            )
            Text(
                text = "$used spent so far — you earn more every match",
                style = MaterialTheme.typography.bodySmall,
                color = Arena.TextMid
            )
        }
    }
}

@Composable
private fun CategoryBreakdown(categoryPoints: Map<String, Int>) {
    val sorted = categoryPoints.entries.sortedByDescending { it.value }
    val max = sorted.firstOrNull()?.value ?: 1

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Arena.Surface.copy(alpha = 0.55f))
            .border(1.dp, Arena.Outline.copy(alpha = 0.6f), RoundedCornerShape(16.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        sorted.forEach { (category, points) ->
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = category,
                        style = MaterialTheme.typography.bodyMedium,
                        color = Arena.TextHi,
                        modifier = Modifier.weight(1f)
                    )
                    Text(
                        text = points.toString(),
                        style = MaterialTheme.typography.bodyMedium,
                        color = Arena.GoldBright,
                        fontWeight = FontWeight.W700
                    )
                }
                Spacer(Modifier.height(6.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(5.dp)
                        .clip(RoundedCornerShape(50))
                        .background(Arena.SurfaceHi)
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth(
                                if (max <= 0) 0f else (points.toFloat() / max).coerceIn(0.04f, 1f)
                            )
                            .height(5.dp)
                            .clip(RoundedCornerShape(50))
                            .background(
                                Brush.horizontalGradient(listOf(Arena.GoldDeep, Arena.GoldBright))
                            )
                    )
                }
            }
        }
    }
}

@Composable
private fun FriendRow(friend: Friend, busy: Boolean, onRemove: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Arena.Surface.copy(alpha = 0.65f))
            .border(1.dp, Arena.Outline.copy(alpha = 0.6f), RoundedCornerShape(14.dp))
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Avatar carries the presence dot as a corner badge, the pattern people
        // already read as "online" from every chat app.
        Box(modifier = Modifier.size(38.dp)) {
            Box(
                modifier = Modifier
                    .size(34.dp)
                    .align(Alignment.TopStart)
                    .clip(RoundedCornerShape(50))
                    .background(Arena.Violet.copy(alpha = 0.22f)),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = friend.username.take(1).uppercase(),
                    style = MaterialTheme.typography.titleMedium,
                    color = Arena.Violet
                )
            }
            Box(
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .size(13.dp)
                    .clip(RoundedCornerShape(50))
                    .background(Arena.Surface),
                contentAlignment = Alignment.Center
            ) {
                PresenceDot(status = friend.status, size = 9.dp)
            }
        }
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = friend.username,
                style = MaterialTheme.typography.bodyLarge,
                color = Arena.TextHi,
                fontWeight = FontWeight.W700
            )
            Spacer(Modifier.height(2.dp))
            PresenceRow(
                status = friend.status,
                matchMode = friend.matchMode,
                lastSeenAt = friend.lastSeenAt
            )
            Spacer(Modifier.height(3.dp))
            Text(
                text = "${friend.totalPoints} pts · ${friend.wins} crowns",
                style = MaterialTheme.typography.bodySmall,
                color = Arena.TextLow
            )
        }
        PressableSurface(
            onClick = onRemove,
            enabled = !busy,
            modifier = Modifier.size(34.dp),
            background = Arena.Magenta.copy(alpha = 0.12f),
            borderColor = Arena.Magenta.copy(alpha = 0.4f),
            shape = RoundedCornerShape(10.dp)
        ) {
            Icon(
                imageVector = Icons.Filled.PersonRemove,
                contentDescription = "Remove ${friend.username}",
                tint = Arena.Magenta,
                modifier = Modifier
                    .align(Alignment.Center)
                    .size(16.dp)
            )
        }
    }
}

@Composable
private fun SectionHeader(title: String, trailing: String? = null) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = title.uppercase(),
            style = MaterialTheme.typography.labelMedium,
            color = Arena.TextLow,
            letterSpacing = 2.sp,
            modifier = Modifier.weight(1f)
        )
        if (trailing != null) {
            Text(
                text = trailing,
                style = MaterialTheme.typography.labelMedium,
                color = Arena.TextMid
            )
        }
    }
}

@Composable
private fun Divider() {
    Box(
        modifier = Modifier
            .width(1.dp)
            .height(34.dp)
            .background(Arena.Outline.copy(alpha = 0.6f))
    )
}
