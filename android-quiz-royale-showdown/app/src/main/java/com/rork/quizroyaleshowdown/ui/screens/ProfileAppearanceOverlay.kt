package com.rork.quizroyaleshowdown.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Stars
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.rork.quizroyaleshowdown.data.AppearanceViewModel
import com.rork.quizroyaleshowdown.data.AuthViewModel
import com.rork.quizroyaleshowdown.data.CosmeticItem
import com.rork.quizroyaleshowdown.ui.theme.Arena

/**
 * Keeps the existing record/friends screen intact while making equipped
 * cosmetics visible outside Store. The overlay is deliberately compact so the
 * underlying profile remains the authoritative interaction surface.
 */
@Composable
fun ProfileScreenWithAppearance(
    viewModel: AuthViewModel,
    appearanceViewModel: AppearanceViewModel,
    onBack: () -> Unit,
    onRegister: () -> Unit
) {
    val authState by viewModel.uiState.collectAsStateWithLifecycle()
    val appearance by appearanceViewModel.uiState.collectAsStateWithLifecycle()

    LaunchedEffect(authState.identity.isRegistered) {
        if (authState.identity.isRegistered) appearanceViewModel.refresh()
    }

    Box(modifier = Modifier.fillMaxSize()) {
        ProfileScreen(
            viewModel = viewModel,
            onBack = onBack,
            onRegister = onRegister
        )

        if (authState.identity.isRegistered && appearance.equipped.isNotEmpty()) {
            EquippedAppearanceChip(
                playerName = authState.identity.displayName,
                equipped = appearance.equipped,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .systemBarsPadding()
                    .padding(top = 8.dp, end = 20.dp)
            )
        }
    }
}

@Composable
private fun EquippedAppearanceChip(
    playerName: String,
    equipped: List<CosmeticItem>,
    modifier: Modifier = Modifier
) {
    val frame = equipped.firstOrNull { it.cosmeticType == "avatar_frame" }
    val banner = equipped.firstOrNull { it.cosmeticType == "banner" }
    val title = equipped.firstOrNull { it.cosmeticType == "title" }
    val badge = equipped.firstOrNull { it.cosmeticType == "badge" }
    val accent = listOfNotNull(frame, banner, title, badge)
        .maxByOrNull { it.rarity.rank() }
        ?.rarity
        .rarityColor()

    Row(
        modifier = modifier
            .clip(RoundedCornerShape(16.dp))
            .background(
                Brush.horizontalGradient(
                    listOf(accent.copy(alpha = 0.24f), Arena.Surface.copy(alpha = 0.94f))
                )
            )
            .border(1.dp, accent.copy(alpha = 0.7f), RoundedCornerShape(16.dp))
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(34.dp)
                .clip(CircleShape)
                .background(Arena.Canvas)
                .border(if (frame != null) 2.dp else 1.dp, accent, CircleShape),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                Icons.Filled.Stars,
                contentDescription = null,
                tint = accent,
                modifier = Modifier.size(17.dp)
            )
        }
        Spacer(Modifier.width(8.dp))
        Column {
            Text(
                text = title?.displayName ?: playerName,
                style = MaterialTheme.typography.labelMedium,
                color = Arena.TextHi,
                fontWeight = FontWeight.W900,
                maxLines = 1
            )
            Text(
                text = listOfNotNull(
                    frame?.displayName,
                    banner?.displayName,
                    badge?.displayName
                ).take(2).joinToString(" · ").ifBlank { "Equipped look" },
                style = MaterialTheme.typography.labelSmall,
                color = accent,
                maxLines = 1
            )
        }
    }
}

private fun String.rank(): Int = when (lowercase()) {
    "legendary" -> 4
    "epic" -> 3
    "rare" -> 2
    else -> 1
}

private fun String?.rarityColor(): Color = when (this?.lowercase()) {
    "legendary" -> Arena.GoldBright
    "epic" -> Arena.Magenta
    "rare" -> Arena.Cyan
    else -> Arena.TextMid
}
