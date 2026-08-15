package com.rork.quizroyaleshowdown.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rork.quizroyaleshowdown.ui.theme.Arena

/**
 * Labelled text input in the arena style. The border tracks focus and error
 * state so a rejected field is impossible to miss.
 */
@Composable
fun ArenaTextField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "",
    error: String? = null,
    helper: String? = null,
    isPassword: Boolean = false,
    keyboardType: KeyboardType = KeyboardType.Text,
    imeAction: ImeAction = ImeAction.Next,
    enabled: Boolean = true,
    maxLength: Int = 128
) {
    var focused by remember { mutableStateOf(false) }
    var revealed by remember { mutableStateOf(false) }

    val borderColor by animateColorAsState(
        targetValue = when {
            error != null -> Arena.Magenta
            focused -> Arena.Gold
            else -> Arena.Outline
        },
        label = "field-border"
    )

    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = label.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = if (error != null) Arena.Magenta else Arena.TextLow,
            letterSpacing = 1.5.sp
        )
        Spacer(Modifier.height(6.dp))

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(Arena.Surface.copy(alpha = if (enabled) 0.9f else 0.4f))
                .border(1.dp, borderColor, RoundedCornerShape(14.dp))
                .padding(horizontal = 14.dp, vertical = 14.dp),
            contentAlignment = Alignment.CenterStart
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(modifier = Modifier.weight(1f)) {
                    if (value.isEmpty() && placeholder.isNotEmpty()) {
                        Text(
                            text = placeholder,
                            style = MaterialTheme.typography.bodyLarge,
                            color = Arena.TextLow.copy(alpha = 0.7f)
                        )
                    }
                    BasicTextField(
                        value = value,
                        onValueChange = { if (it.length <= maxLength) onValueChange(it) },
                        singleLine = true,
                        enabled = enabled,
                        textStyle = TextStyle(
                            color = Arena.TextHi,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.W600
                        ),
                        cursorBrush = SolidColor(Arena.Gold),
                        visualTransformation = if (isPassword && !revealed) {
                            PasswordVisualTransformation()
                        } else {
                            VisualTransformation.None
                        },
                        keyboardOptions = KeyboardOptions(
                            keyboardType = keyboardType,
                            imeAction = imeAction
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .onFocusChanged { focused = it.isFocused }
                    )
                }

                if (isPassword) {
                    Spacer(Modifier.width(10.dp))
                    Box(
                        modifier = Modifier
                            .size(24.dp)
                            .clip(RoundedCornerShape(6.dp)),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = if (revealed) {
                                Icons.Filled.VisibilityOff
                            } else {
                                Icons.Filled.Visibility
                            },
                            contentDescription = if (revealed) "Hide password" else "Show password",
                            tint = Arena.TextLow,
                            modifier = Modifier
                                .size(20.dp)
                                .clip(RoundedCornerShape(4.dp))
                                .then(
                                    Modifier.androidxClickable { revealed = !revealed }
                                )
                        )
                    }
                }
            }
        }

        AnimatedVisibility(
            visible = error != null || helper != null,
            enter = fadeIn() + expandVertically(),
            exit = fadeOut() + shrinkVertically()
        ) {
            Row(
                modifier = Modifier.padding(top = 6.dp, start = 2.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                if (error != null) {
                    Icon(
                        imageVector = Icons.Filled.ErrorOutline,
                        contentDescription = null,
                        tint = Arena.Magenta,
                        modifier = Modifier.size(13.dp)
                    )
                    Spacer(Modifier.width(5.dp))
                }
                Text(
                    text = error ?: helper.orEmpty(),
                    style = MaterialTheme.typography.bodySmall,
                    color = if (error != null) Arena.Magenta else Arena.TextLow
                )
            }
        }
    }
}

/** Private clickable helper so the icon stays a plain Icon in the tree. */
@Composable
private fun Modifier.androidxClickable(onClick: () -> Unit): Modifier {
    val interaction = remember { MutableInteractionSource() }
    return this.then(
        Modifier.clickable(
            interactionSource = interaction,
            indication = null,
            onClick = onClick
        )
    )
}

/** Primary call-to-action: gradient fill, press dip, inline busy spinner. */
@Composable
fun ArenaButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    busy: Boolean = false,
    colors: List<Color> = listOf(Arena.GoldBright, Arena.GoldDeep),
    contentColor: Color = Arena.Ink
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed && enabled && !busy) 0.97f else 1f,
        label = "cta-scale"
    )
    val active = enabled && !busy

    Box(
        modifier = modifier
            .fillMaxWidth()
            .scale(scale)
            .clip(RoundedCornerShape(16.dp))
            .background(
                if (active) {
                    Brush.horizontalGradient(colors)
                } else {
                    Brush.horizontalGradient(listOf(Arena.SurfaceHi, Arena.SurfaceHi))
                }
            )
            .then(
                if (active) {
                    Modifier.androidxClickable(onClick)
                } else {
                    Modifier
                }
            )
            .padding(vertical = 16.dp),
        contentAlignment = Alignment.Center
    ) {
        if (busy) {
            CircularProgressIndicator(
                modifier = Modifier.size(20.dp),
                color = contentColor,
                strokeWidth = 2.dp
            )
        } else {
            Text(
                text = text.uppercase(),
                style = MaterialTheme.typography.labelLarge,
                color = if (active) contentColor else Arena.TextLow,
                letterSpacing = 1.5.sp,
                fontWeight = FontWeight.W800
            )
        }
    }
}

/** Secondary, outlined action for lower-emphasis choices. */
@Composable
fun ArenaOutlineButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    accent: Color = Arena.Cyan,
    enabled: Boolean = true
) {
    PressableSurface(
        onClick = onClick,
        modifier = modifier.fillMaxWidth(),
        enabled = enabled,
        background = accent.copy(alpha = 0.10f),
        borderColor = accent.copy(alpha = 0.5f),
        shape = RoundedCornerShape(16.dp)
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 15.dp),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = text.uppercase(),
                style = MaterialTheme.typography.labelLarge,
                color = if (enabled) accent else Arena.TextLow,
                letterSpacing = 1.5.sp,
                fontWeight = FontWeight.W800
            )
        }
    }
}

/** Checkbox row used for the opt-in guest stat transfer. */
@Composable
fun ArenaCheckRow(
    checked: Boolean,
    onToggle: () -> Unit,
    title: String,
    subtitle: String? = null,
    accent: Color = Arena.Cyan,
    modifier: Modifier = Modifier
) {
    PressableSurface(
        onClick = onToggle,
        modifier = modifier.fillMaxWidth(),
        background = if (checked) accent.copy(alpha = 0.10f) else Arena.Surface.copy(alpha = 0.6f),
        borderColor = if (checked) accent.copy(alpha = 0.55f) else Arena.Outline,
        shape = RoundedCornerShape(14.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(22.dp)
                    .clip(RoundedCornerShape(7.dp))
                    .background(if (checked) accent else Color.Transparent)
                    .border(
                        1.5.dp,
                        if (checked) accent else Arena.Outline,
                        RoundedCornerShape(7.dp)
                    ),
                contentAlignment = Alignment.Center
            ) {
                if (checked) {
                    Icon(
                        imageVector = Icons.Filled.Check,
                        contentDescription = null,
                        tint = Arena.Ink,
                        modifier = Modifier.size(15.dp)
                    )
                }
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.bodyMedium,
                    color = Arena.TextHi,
                    fontWeight = FontWeight.W700
                )
                if (subtitle != null) {
                    Spacer(Modifier.height(2.dp))
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = Arena.TextMid
                    )
                }
            }
        }
    }
}

/** Inline banner for a server error or a success notice. */
@Composable
fun ArenaBanner(
    message: String,
    isError: Boolean,
    modifier: Modifier = Modifier
) {
    val accent = if (isError) Arena.Magenta else Arena.Cyan
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(accent.copy(alpha = 0.12f))
            .border(1.dp, accent.copy(alpha = 0.4f), RoundedCornerShape(12.dp))
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = if (isError) Icons.Filled.ErrorOutline else Icons.Filled.Check,
            contentDescription = null,
            tint = accent,
            modifier = Modifier.size(16.dp)
        )
        Spacer(Modifier.width(10.dp))
        Text(
            text = message,
            style = MaterialTheme.typography.bodySmall,
            color = Arena.TextHi
        )
    }
}
