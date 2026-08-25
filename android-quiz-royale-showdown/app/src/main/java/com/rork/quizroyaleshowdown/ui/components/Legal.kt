package com.rork.quizroyaleshowdown.ui.components

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.rork.quizroyaleshowdown.data.Backend
import com.rork.quizroyaleshowdown.ui.theme.Arena

private const val TAG = "Legal"

/**
 * Canonical locations of the legal documents.
 *
 * Privacy and Terms are served by our own Worker (see `functions/legal.ts`) so
 * they live at a stable, crawlable URL that Google Play and App Store Review can
 * both reach. The EULA points at Apple's canonical Standard EULA rather than a
 * copy of it, because Apple requires the real document.
 */
object LegalLinks {
    val privacyPolicy: String get() = "${Backend.baseUrl}/legal/privacy"
    val termsAndConditions: String get() = "${Backend.baseUrl}/legal/terms"

    /** Apple's Licensed Application End User License Agreement. */
    const val EULA: String = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/"
}

/**
 * Opens a legal document in the user's browser. Failing to resolve a browser is
 * survivable — it must never crash the screen the link sits on.
 */
private fun openUrl(context: android.content.Context, url: String) {
    try {
        context.startActivity(
            Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    } catch (e: ActivityNotFoundException) {
        Log.w(TAG, "No browser available to open a legal link: ${e.message}")
    }
}

/**
 * The standard legal footer: Privacy Policy, Terms, and EULA.
 *
 * This is the single component every surface that needs legal links should use —
 * registration, profile, and any future paywall — so the wording and the URLs can
 * never drift between screens.
 *
 * @param prefix optional lead-in sentence, e.g. the consent line shown above a
 *   registration button. Pass null on screens where the links stand alone.
 */
@Composable
fun LegalLinks(
    modifier: Modifier = Modifier,
    prefix: String? = null,
    includeEula: Boolean = true
) {
    val context = LocalContext.current

    if (prefix != null) {
        Text(
            text = prefix,
            style = MaterialTheme.typography.bodySmall,
            color = Arena.TextLow,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 6.dp)
        )
    }

    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically
    ) {
        LegalLink("Privacy Policy") { openUrl(context, LegalLinks.privacyPolicy) }
        Separator()
        LegalLink("Terms") { openUrl(context, LegalLinks.termsAndConditions) }
        if (includeEula) {
            Separator()
            LegalLink("EULA") { openUrl(context, LegalLinks.EULA) }
        }
    }
}

@Composable
private fun LegalLink(label: String, onClick: () -> Unit) {
    // A plain tappable Text rather than a button: these are references, and
    // styling them as buttons would compete with the real call to action.
    PressableSurface(
        onClick = onClick,
        background = androidx.compose.ui.graphics.Color.Transparent,
        borderColor = androidx.compose.ui.graphics.Color.Transparent
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = Arena.TextMid,
            textDecoration = TextDecoration.Underline,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 8.dp)
        )
    }
}

@Composable
private fun Separator() {
    Text(
        text = "·",
        style = MaterialTheme.typography.bodySmall,
        color = Arena.Outline
    )
}
