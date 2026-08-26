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
import com.rork.quizroyaleshowdown.ui.theme.Arena

private const val TAG = "Legal"

/**
 * Public legal-document URLs used by the Android release.
 *
 * Keep these on the canonical Pages origin until quizroyale.gg is registered
 * and delegated. Unlike the game API, legal URLs must remain reachable from a
 * logged-out browser and by app-store crawlers.
 */
object LegalDocumentUrls {
    const val PRIVACY_POLICY = "https://quiz-royale-showdown.pages.dev/privacy-policy/"
    const val TERMS_AND_CONDITIONS = "https://quiz-royale-showdown.pages.dev/terms/"

    /** Apple's Licensed Application End User License Agreement. */
    const val EULA = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/"
}

/** Opens a legal document without crashing if no browser can resolve the URL. */
private fun openUrl(context: android.content.Context, url: String) {
    try {
        context.startActivity(
            Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    } catch (e: ActivityNotFoundException) {
        Log.w(TAG, "No browser available to open a legal link: ${e.message}")
    }
}

/** Shared legal footer for registration, profile, and commerce surfaces. */
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
        LegalLink("Privacy Policy") { openUrl(context, LegalDocumentUrls.PRIVACY_POLICY) }
        Separator()
        LegalLink("Terms") { openUrl(context, LegalDocumentUrls.TERMS_AND_CONDITIONS) }
        if (includeEula) {
            Separator()
            LegalLink("EULA") { openUrl(context, LegalDocumentUrls.EULA) }
        }
    }
}

@Composable
private fun LegalLink(label: String, onClick: () -> Unit) {
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
