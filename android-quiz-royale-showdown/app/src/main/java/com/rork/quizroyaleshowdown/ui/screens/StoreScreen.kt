package com.rork.quizroyaleshowdown.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
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
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Diamond
import androidx.compose.material.icons.filled.LocalMall
import androidx.compose.material.icons.filled.Paid
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.rork.quizroyaleshowdown.data.CosmeticItem
import com.rork.quizroyaleshowdown.data.StoreItem
import com.rork.quizroyaleshowdown.data.StoreViewModel
import com.rork.quizroyaleshowdown.data.VirtualCurrencyBalances
import com.rork.quizroyaleshowdown.ui.components.ArenaBackground
import com.rork.quizroyaleshowdown.ui.components.ArenaOutlineButton
import com.rork.quizroyaleshowdown.ui.components.PressableSurface
import com.rork.quizroyaleshowdown.ui.components.StatBlock
import com.rork.quizroyaleshowdown.ui.components.TagChip
import com.rork.quizroyaleshowdown.ui.theme.Arena

@Composable
fun StoreScreen(
    viewModel: StoreViewModel,
    onBack: () -> Unit,
    onRegister: () -> Unit
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    ArenaBackground(accent = Arena.Gold) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .systemBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 28.dp)
        ) {
            Header(title = "Store", onBack = onBack)
            Spacer(Modifier.height(16.dp))

            if (state.loading) {
                Box(Modifier.fillMaxWidth().padding(vertical = 48.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = Arena.Gold)
                }
                return@Column
            }

            state.error?.let {
                MessageCard(text = it, accent = Arena.Magenta)
                Spacer(Modifier.height(12.dp))
                ArenaOutlineButton(text = "Register or sign in", accent = Arena.Gold, onClick = onRegister)
                return@Column
            }

            BalanceStrip(state.balances)

            state.notice?.let {
                Spacer(Modifier.height(12.dp))
                MessageCard(text = it, accent = Arena.Cyan)
            }

            Spacer(Modifier.height(20.dp))
            SectionHeader("Power-ups and passes")
            Spacer(Modifier.height(10.dp))
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                state.items.forEach { item ->
                    StoreItemCard(
                        item = item,
                        busy = state.busyItemId == item.itemId,
                        onBuy = { viewModel.purchase(item) }
                    )
                }
            }

            Spacer(Modifier.height(22.dp))
            SectionHeader("Cosmetics")
            Spacer(Modifier.height(10.dp))
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                state.cosmetics.forEach { cosmetic ->
                    CosmeticCard(
                        cosmetic = cosmetic,
                        busy = state.busyItemId == cosmetic.cosmeticId,
                        onEquip = { viewModel.equip(cosmetic) }
                    )
                }
            }
        }
    }
}

@Composable
private fun Header(title: String, onBack: () -> Unit) {
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
            text = title.uppercase(),
            style = MaterialTheme.typography.headlineMedium,
            color = Arena.TextHi,
            fontWeight = FontWeight.W900
        )
    }
}

@Composable
private fun BalanceStrip(balances: VirtualCurrencyBalances) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
        StatBlock(label = "Coins", value = balances.coins.toString(), color = Arena.Gold, modifier = Modifier.weight(1f))
        StatBlock(label = "Gems", value = balances.gems.toString(), color = Arena.Cyan, modifier = Modifier.weight(1f))
        StatBlock(label = "Tickets", value = balances.seasonalTickets.toString(), color = Arena.Violet, modifier = Modifier.weight(1f))
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
private fun StoreItemCard(item: StoreItem, busy: Boolean, onBuy: () -> Unit) {
    SurfaceCard(accent = item.currencyColor()) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            Icon(
                imageVector = if (item.currency == "gems") Icons.Filled.Diamond else Icons.Filled.Paid,
                contentDescription = null,
                tint = item.currencyColor(),
                modifier = Modifier.size(28.dp)
            )
            Spacer(Modifier.size(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(item.displayName, style = MaterialTheme.typography.titleMedium, color = Arena.TextHi, fontWeight = FontWeight.W800)
                Text(item.description, style = MaterialTheme.typography.bodySmall, color = Arena.TextLow)
                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TagChip(text = item.itemType.replace('_', ' '), color = item.currencyColor())
                    TagChip(text = "${item.price} ${item.currency}", color = Arena.TextMid)
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        ArenaOutlineButton(
            text = if (item.owned) "Owned" else "Buy",
            accent = item.currencyColor(),
            enabled = !item.owned && !busy,
            onClick = onBuy
        )
    }
}

@Composable
private fun CosmeticCard(cosmetic: CosmeticItem, busy: Boolean, onEquip: () -> Unit) {
    SurfaceCard(accent = cosmetic.rarityColor()) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            Icon(
                imageVector = if (cosmetic.equipped) Icons.Filled.CheckCircle else Icons.Filled.LocalMall,
                contentDescription = null,
                tint = cosmetic.rarityColor(),
                modifier = Modifier.size(28.dp)
            )
            Spacer(Modifier.size(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(cosmetic.displayName, style = MaterialTheme.typography.titleMedium, color = Arena.TextHi, fontWeight = FontWeight.W800)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TagChip(text = cosmetic.cosmeticType.replace('_', ' '), color = Arena.Cyan)
                    TagChip(text = cosmetic.rarity, color = cosmetic.rarityColor())
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        ArenaOutlineButton(
            text = when {
                cosmetic.equipped -> "Equipped"
                cosmetic.owned -> "Equip"
                else -> "Locked"
            },
            accent = cosmetic.rarityColor(),
            enabled = cosmetic.owned && !cosmetic.equipped && !busy,
            onClick = onEquip
        )
    }
}

@Composable
private fun MessageCard(text: String, accent: Color) {
    SurfaceCard(accent = accent) {
        Text(text = text, style = MaterialTheme.typography.bodyMedium, color = Arena.TextHi)
    }
}

@Composable
private fun SurfaceCard(accent: Color, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(Arena.Surface.copy(alpha = 0.72f))
            .padding(14.dp),
        content = content
    )
}

private fun StoreItem.currencyColor(): Color = when (currency) {
    "gems" -> Arena.Cyan
    "seasonalTickets" -> Arena.Violet
    else -> Arena.Gold
}

private fun CosmeticItem.rarityColor(): Color = when (rarity) {
    "legendary" -> Arena.GoldBright
    "epic" -> Arena.Magenta
    "rare" -> Arena.Cyan
    else -> Arena.TextMid
}
