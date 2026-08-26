package com.rork.quizroyaleshowdown.ui.screens

import android.app.Activity
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Diamond
import androidx.compose.material.icons.filled.LocalMall
import androidx.compose.material.icons.filled.Paid
import androidx.compose.material.icons.filled.Stars
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.rork.quizroyaleshowdown.data.BillingStoreState
import com.rork.quizroyaleshowdown.data.CosmeticItem
import com.rork.quizroyaleshowdown.data.CurrencyPackOffer
import com.rork.quizroyaleshowdown.data.StoreItem
import com.rork.quizroyaleshowdown.data.StoreViewModel
import com.rork.quizroyaleshowdown.data.VirtualCurrencyBalances
import com.rork.quizroyaleshowdown.ui.components.ArenaBackground
import com.rork.quizroyaleshowdown.ui.components.ArenaOutlineButton
import com.rork.quizroyaleshowdown.ui.components.LegalLinks
import com.rork.quizroyaleshowdown.ui.components.PressableSurface
import com.rork.quizroyaleshowdown.ui.components.StatBlock
import com.rork.quizroyaleshowdown.ui.components.TagChip
import com.rork.quizroyaleshowdown.ui.theme.Arena
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

private const val AUTH_REQUIRED_MESSAGE = "Register or sign in to use the store."

@Composable
fun StoreScreen(
    viewModel: StoreViewModel,
    onBack: () -> Unit,
    onRegister: () -> Unit
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val billing by viewModel.billingState.collectAsStateWithLifecycle()
    val activity = LocalContext.current as? Activity

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

            state.error?.let { error ->
                val requiresAuth = error == AUTH_REQUIRED_MESSAGE
                MessageCard(text = error, accent = Arena.Magenta)
                Spacer(Modifier.height(12.dp))
                ArenaOutlineButton(
                    text = if (requiresAuth) "Register or sign in" else "Retry store",
                    accent = Arena.Gold,
                    onClick = {
                        if (requiresAuth) onRegister() else viewModel.refresh()
                    }
                )
                return@Column
            }

            BalanceStrip(state.balances)

            state.notice?.let {
                Spacer(Modifier.height(12.dp))
                MessageCard(text = it, accent = Arena.Cyan)
            }
            billing.notice?.let {
                Spacer(Modifier.height(12.dp))
                MessageCard(text = it, accent = Arena.Cyan)
            }
            billing.error?.let {
                Spacer(Modifier.height(12.dp))
                MessageCard(text = it, accent = Arena.Magenta)
            }

            Spacer(Modifier.height(22.dp))
            SectionHeader("Coins & gems")
            Spacer(Modifier.height(6.dp))
            Text(
                text = "Optional Google Play purchases. Match rewards still earn currency for free.",
                style = MaterialTheme.typography.bodySmall,
                color = Arena.TextLow
            )
            Spacer(Modifier.height(10.dp))
            PaidCurrencySection(
                billing = billing,
                activityAvailable = activity != null,
                onBuy = { offer -> activity?.let { viewModel.buyCurrency(it, offer) } }
            )

            val powerUps = state.items.filter { it.itemType == "POWERUP_CHARGE" }
            if (powerUps.isNotEmpty()) {
                Spacer(Modifier.height(22.dp))
                SectionHeader("Power-ups")
                Spacer(Modifier.height(10.dp))
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    powerUps.forEach { item ->
                        StoreItemCard(
                            item = item,
                            busy = state.busyItemId == item.itemId,
                            onBuy = { viewModel.purchase(item) }
                        )
                    }
                }
            }

            val passes = state.items.filter { it.itemType == "SEASON_PASS" }
            if (passes.isNotEmpty()) {
                Spacer(Modifier.height(22.dp))
                SectionHeader("Season pass")
                Spacer(Modifier.height(10.dp))
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    passes.forEach { item ->
                        StoreItemCard(
                            item = item,
                            busy = state.busyItemId == item.itemId,
                            onBuy = { viewModel.purchase(item) }
                        )
                    }
                }
            }

            Spacer(Modifier.height(22.dp))
            SectionHeader("Cosmetics")
            Spacer(Modifier.height(6.dp))
            Text(
                text = "Unlock a look with earned currency, then equip it immediately.",
                style = MaterialTheme.typography.bodySmall,
                color = Arena.TextLow
            )
            Spacer(Modifier.height(10.dp))
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                state.cosmetics.forEach { cosmetic ->
                    val storeItem = state.items.firstOrNull {
                        it.itemType == "COSMETIC" && it.cosmeticId() == cosmetic.cosmeticId
                    }
                    CosmeticCard(
                        cosmetic = cosmetic,
                        storeItem = storeItem,
                        busy = state.busyItemId == cosmetic.cosmeticId || state.busyItemId == storeItem?.itemId,
                        onBuy = { storeItem?.let(viewModel::purchase) },
                        onEquip = { viewModel.equip(cosmetic) }
                    )
                }
            }

            Spacer(Modifier.height(28.dp))
            LegalLinks(
                prefix = "Google Play handles payment processing. Review the purchase and privacy terms before buying."
            )
        }
    }
}

@Composable
private fun PaidCurrencySection(
    billing: BillingStoreState,
    activityAvailable: Boolean,
    onBuy: (CurrencyPackOffer) -> Unit
) {
    if (billing.loading && billing.offers.isEmpty()) {
        Box(Modifier.fillMaxWidth().padding(vertical = 20.dp), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = Arena.Cyan, modifier = Modifier.size(24.dp))
        }
        return
    }
    if (billing.offers.isEmpty()) {
        MessageCard(
            text = "Google Play currency packs are not available for this build or account yet.",
            accent = Arena.TextLow
        )
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        billing.offers.forEach { offer ->
            CurrencyPackCard(
                offer = offer,
                busy = billing.purchasingProductId == offer.productId,
                enabled = activityAvailable && offer.available && billing.purchasingProductId == null,
                onBuy = { onBuy(offer) }
            )
        }
    }
}

@Composable
private fun CurrencyPackCard(
    offer: CurrencyPackOffer,
    busy: Boolean,
    enabled: Boolean,
    onBuy: () -> Unit
) {
    val accent = if (offer.currency == "gems") Arena.Cyan else Arena.Gold
    SurfaceCard(accent = accent) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            Icon(
                imageVector = if (offer.currency == "gems") Icons.Filled.Diamond else Icons.Filled.Paid,
                contentDescription = null,
                tint = accent,
                modifier = Modifier.size(30.dp)
            )
            Spacer(Modifier.size(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    "+${offer.amount} ${offer.currency.uppercase()}",
                    style = MaterialTheme.typography.titleMedium,
                    color = Arena.TextHi,
                    fontWeight = FontWeight.W900
                )
                Text(
                    offer.formattedPrice ?: "Not currently offered by Google Play",
                    style = MaterialTheme.typography.bodySmall,
                    color = if (offer.available) accent else Arena.TextLow
                )
            }
        }
        Spacer(Modifier.height(10.dp))
        ArenaOutlineButton(
            text = when {
                busy -> "Checking purchase…"
                offer.available -> "Buy ${offer.formattedPrice.orEmpty()}"
                else -> "Unavailable"
            },
            accent = accent,
            enabled = enabled && !busy,
            onClick = onBuy
        )
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
            text = if (item.owned) "Owned" else if (busy) "Purchasing…" else "Buy",
            accent = item.currencyColor(),
            enabled = !item.owned && !busy,
            onClick = onBuy
        )
    }
}

@Composable
private fun CosmeticCard(
    cosmetic: CosmeticItem,
    storeItem: StoreItem?,
    busy: Boolean,
    onBuy: () -> Unit,
    onEquip: () -> Unit
) {
    val accent = cosmetic.rarityColor()
    SurfaceCard(accent = accent) {
        CosmeticPreview(cosmetic)
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            Icon(
                imageVector = if (cosmetic.equipped) Icons.Filled.CheckCircle else Icons.Filled.LocalMall,
                contentDescription = null,
                tint = accent,
                modifier = Modifier.size(26.dp)
            )
            Spacer(Modifier.size(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(cosmetic.displayName, style = MaterialTheme.typography.titleMedium, color = Arena.TextHi, fontWeight = FontWeight.W800)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TagChip(text = cosmetic.cosmeticType.replace('_', ' '), color = Arena.Cyan)
                    TagChip(text = cosmetic.rarity, color = accent)
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        when {
            cosmetic.equipped -> ArenaOutlineButton(
                text = "Equipped",
                accent = accent,
                enabled = false,
                onClick = {}
            )
            cosmetic.owned -> ArenaOutlineButton(
                text = if (busy) "Equipping…" else "Equip",
                accent = accent,
                enabled = !busy,
                onClick = onEquip
            )
            storeItem != null -> ArenaOutlineButton(
                text = if (busy) "Purchasing…" else "Unlock · ${storeItem.price} ${storeItem.currency}",
                accent = storeItem.currencyColor(),
                enabled = !busy,
                onClick = onBuy
            )
            else -> ArenaOutlineButton(
                text = "Not currently obtainable",
                accent = Arena.TextLow,
                enabled = false,
                onClick = {}
            )
        }
    }
}

@Composable
private fun CosmeticPreview(cosmetic: CosmeticItem) {
    val accent = cosmetic.rarityColor()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(accent.copy(alpha = 0.08f))
            .border(1.dp, accent.copy(alpha = 0.5f), RoundedCornerShape(14.dp))
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(44.dp)
                .clip(RoundedCornerShape(if (cosmetic.cosmeticType == "avatar_frame") 22.dp else 10.dp))
                .background(Arena.Canvas)
                .border(2.dp, accent, RoundedCornerShape(if (cosmetic.cosmeticType == "avatar_frame") 22.dp else 10.dp)),
            contentAlignment = Alignment.Center
        ) {
            Icon(Icons.Filled.Stars, contentDescription = null, tint = accent, modifier = Modifier.size(20.dp))
        }
        Spacer(Modifier.width(12.dp))
        Column {
            Text("PREVIEW", style = MaterialTheme.typography.labelSmall, color = Arena.TextLow)
            Text(
                when (cosmetic.cosmeticType) {
                    "title" -> "Challenger · ${cosmetic.displayName}"
                    "banner" -> "Profile banner · ${cosmetic.displayName}"
                    "badge" -> "Badge · ${cosmetic.displayName}"
                    else -> "Avatar frame · ${cosmetic.displayName}"
                },
                style = MaterialTheme.typography.bodyMedium,
                color = Arena.TextHi,
                fontWeight = FontWeight.W700
            )
        }
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
            .border(1.dp, accent.copy(alpha = 0.22f), RoundedCornerShape(18.dp))
            .padding(14.dp),
        content = content
    )
}

private fun StoreItem.cosmeticId(): String? =
    payload["cosmeticId"]?.jsonPrimitive?.contentOrNull

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
