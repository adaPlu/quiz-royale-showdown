package com.rork.quizroyaleshowdown.ui.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Lock
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
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.rork.quizroyaleshowdown.data.AuthViewModel
import com.rork.quizroyaleshowdown.data.Identity
import com.rork.quizroyaleshowdown.ui.components.ArenaBackground
import com.rork.quizroyaleshowdown.ui.components.ArenaBanner
import com.rork.quizroyaleshowdown.ui.components.ArenaButton
import com.rork.quizroyaleshowdown.ui.components.ArenaCheckRow
import com.rork.quizroyaleshowdown.ui.components.ArenaTextField
import com.rork.quizroyaleshowdown.ui.components.PressableSurface
import com.rork.quizroyaleshowdown.ui.theme.Arena

/** Which half of the identity flow is on screen. */
enum class AuthMode { REGISTER, LOGIN }

/**
 * Account creation and sign-in. Validation runs locally for instant feedback and
 * the server's own field errors take over on submit, so the two can never
 * disagree about what is acceptable.
 */
@Composable
fun AuthScreen(
    viewModel: AuthViewModel,
    initialMode: AuthMode,
    onDone: () -> Unit,
    onBack: () -> Unit
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val haptics = LocalHapticFeedback.current

    var mode by remember { mutableStateOf(initialMode) }
    var username by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var identifier by remember { mutableStateOf("") }
    var transferStats by remember { mutableStateOf(true) }
    var touched by remember { mutableStateOf(false) }

    val guest = state.identity as? Identity.Guest
    val guestPoints = guest?.session?.stats?.totalPoints ?: 0

    // Local mirrors of the server's rules, only surfaced after a submit attempt.
    val localUsernameError = if (touched) validateUsernameLocal(username) else null
    val localEmailError = if (touched) validateEmailLocal(email) else null
    val localPasswordError = if (touched) validatePasswordLocal(password, username) else null

    val usernameError = state.fieldErrors["username"] ?: localUsernameError
    val emailError = state.fieldErrors["email"] ?: localEmailError
    val passwordError = state.fieldErrors["password"] ?: localPasswordError

    LaunchedEffect(mode) { viewModel.clearMessages() }

    ArenaBackground(accent = if (mode == AuthMode.REGISTER) Arena.Gold else Arena.Violet) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .systemBarsPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 28.dp)
        ) {
            Spacer(Modifier.height(12.dp))

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

            Spacer(Modifier.height(22.dp))

            Text(
                text = if (mode == AuthMode.REGISTER) "CLAIM YOUR\nCROWN" else "WELCOME\nBACK",
                style = MaterialTheme.typography.displayLarge.copy(
                    brush = Brush.horizontalGradient(
                        if (mode == AuthMode.REGISTER) {
                            listOf(Arena.GoldBright, Arena.Gold, Arena.GoldDeep)
                        } else {
                            listOf(Arena.Cyan, Arena.Violet)
                        }
                    )
                ),
                fontSize = 34.sp,
                letterSpacing = 1.sp,
                lineHeight = 38.sp
            )

            Spacer(Modifier.height(8.dp))

            Text(
                text = if (mode == AuthMode.REGISTER) {
                    "A registered account keeps your stats forever, unlocks friends, and holds your leaderboard spot."
                } else {
                    "Sign in to pick your record back up exactly where you left it."
                },
                style = MaterialTheme.typography.bodyMedium,
                color = Arena.TextMid
            )

            Spacer(Modifier.height(20.dp))

            ModeToggle(mode = mode, onSelect = { mode = it })

            Spacer(Modifier.height(20.dp))

            if (state.error != null) {
                ArenaBanner(message = state.error.orEmpty(), isError = true)
                Spacer(Modifier.height(14.dp))
            }

            AnimatedContent(
                targetState = mode,
                transitionSpec = {
                    (fadeIn(tween(180)) togetherWith fadeOut(tween(120)))
                },
                label = "auth-form"
            ) { current ->
                Column {
                    if (current == AuthMode.REGISTER) {
                        ArenaTextField(
                            label = "Username",
                            value = username,
                            onValueChange = { username = it },
                            placeholder = "3-16 letters, numbers or _",
                            error = usernameError,
                            enabled = !state.busy,
                            maxLength = 16,
                            imeAction = ImeAction.Next
                        )
                        Spacer(Modifier.height(16.dp))
                        ArenaTextField(
                            label = "Email",
                            value = email,
                            onValueChange = { email = it },
                            placeholder = "you@example.com",
                            error = emailError,
                            enabled = !state.busy,
                            keyboardType = KeyboardType.Email,
                            maxLength = 254
                        )
                        Spacer(Modifier.height(16.dp))
                        ArenaTextField(
                            label = "Password",
                            value = password,
                            onValueChange = { password = it },
                            placeholder = "At least 8 characters",
                            error = passwordError,
                            helper = if (passwordError == null) {
                                "Needs a letter and a number. Stored hashed, never as text."
                            } else {
                                null
                            },
                            isPassword = true,
                            enabled = !state.busy,
                            keyboardType = KeyboardType.Password,
                            imeAction = ImeAction.Done
                        )

                        if (guest != null && guestPoints > 0) {
                            Spacer(Modifier.height(18.dp))
                            ArenaCheckRow(
                                checked = transferStats,
                                onToggle = { transferStats = !transferStats },
                                title = "Bring my guest run with me",
                                subtitle = "Move $guestPoints points, " +
                                    "${guest.session.stats.wins}W/${guest.session.stats.losses}L " +
                                    "and category progress into the new account."
                            )
                        }
                    } else {
                        ArenaTextField(
                            label = "Username or email",
                            value = identifier,
                            onValueChange = { identifier = it },
                            placeholder = "How you signed up",
                            error = state.fieldErrors["identifier"],
                            enabled = !state.busy,
                            maxLength = 254
                        )
                        Spacer(Modifier.height(16.dp))
                        ArenaTextField(
                            label = "Password",
                            value = password,
                            onValueChange = { password = it },
                            placeholder = "Your password",
                            error = state.fieldErrors["password"],
                            isPassword = true,
                            enabled = !state.busy,
                            keyboardType = KeyboardType.Password,
                            imeAction = ImeAction.Done
                        )
                    }
                }
            }

            Spacer(Modifier.height(24.dp))

            ArenaButton(
                text = if (mode == AuthMode.REGISTER) "Create account" else "Sign in",
                busy = state.busy,
                colors = if (mode == AuthMode.REGISTER) {
                    listOf(Arena.GoldBright, Arena.GoldDeep)
                } else {
                    listOf(Arena.Cyan, Arena.CyanDeep)
                },
                onClick = {
                    touched = true
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    if (mode == AuthMode.REGISTER) {
                        val valid = validateUsernameLocal(username) == null &&
                            validateEmailLocal(email) == null &&
                            validatePasswordLocal(password, username) == null
                        if (valid) {
                            viewModel.register(
                                username = username,
                                email = email,
                                password = password,
                                transferGuestStats = transferStats && guestPoints > 0,
                                onSuccess = onDone
                            )
                        }
                    } else {
                        if (identifier.isNotBlank() && password.isNotBlank()) {
                            viewModel.login(identifier, password, onDone)
                        }
                    }
                }
            )

            Spacer(Modifier.height(16.dp))

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(Arena.Surface.copy(alpha = 0.45f))
                    .border(1.dp, Arena.Outline.copy(alpha = 0.5f), RoundedCornerShape(12.dp))
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Icon(
                    imageVector = Icons.Filled.Lock,
                    contentDescription = null,
                    tint = Arena.Cyan,
                    modifier = Modifier.size(15.dp)
                )
                Text(
                    text = "Your password is hashed on the server with a per-account salt. " +
                        "It is never stored on this device.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Arena.TextLow
                )
            }

            Spacer(Modifier.height(18.dp))

            Text(
                text = "Not ready? You can keep playing as a guest.",
                style = MaterialTheme.typography.bodySmall,
                color = Arena.TextLow,
                modifier = Modifier.fillMaxWidth(),
                textAlign = TextAlign.Center
            )
        }
    }
}

@Composable
private fun ModeToggle(mode: AuthMode, onSelect: (AuthMode) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Arena.Surface.copy(alpha = 0.6f))
            .border(1.dp, Arena.Outline, RoundedCornerShape(14.dp))
            .padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        ToggleHalf(
            label = "Register",
            selected = mode == AuthMode.REGISTER,
            accent = Arena.Gold,
            onClick = { onSelect(AuthMode.REGISTER) },
            modifier = Modifier.weight(1f)
        )
        ToggleHalf(
            label = "Sign in",
            selected = mode == AuthMode.LOGIN,
            accent = Arena.Cyan,
            onClick = { onSelect(AuthMode.LOGIN) },
            modifier = Modifier.weight(1f)
        )
    }
}

@Composable
private fun ToggleHalf(
    label: String,
    selected: Boolean,
    accent: androidx.compose.ui.graphics.Color,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(11.dp))
            .background(if (selected) accent.copy(alpha = 0.18f) else androidx.compose.ui.graphics.Color.Transparent)
            .then(
                if (selected) {
                    Modifier.border(1.dp, accent.copy(alpha = 0.5f), RoundedCornerShape(11.dp))
                } else {
                    Modifier
                }
            ),
        contentAlignment = Alignment.Center
    ) {
        PressableSurface(
            onClick = onClick,
            background = androidx.compose.ui.graphics.Color.Transparent,
            borderColor = androidx.compose.ui.graphics.Color.Transparent,
            shape = RoundedCornerShape(11.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Text(
                text = label.uppercase(),
                style = MaterialTheme.typography.labelMedium,
                color = if (selected) accent else Arena.TextLow,
                letterSpacing = 1.2.sp,
                fontWeight = FontWeight.W800,
                modifier = Modifier
                    .align(Alignment.Center)
                    .padding(vertical = 11.dp)
            )
        }
    }
}

// ------------------------------------------------------- local rule mirrors

private val USERNAME_REGEX = Regex("^[A-Za-z0-9_]+$")
private val EMAIL_REGEX = Regex("^[^\\s@]+@[^\\s@.]+(\\.[^\\s@.]+)+$")

private fun validateUsernameLocal(value: String): String? {
    val trimmed = value.trim()
    return when {
        trimmed.isEmpty() -> "Username is required."
        trimmed.length < 3 -> "Username must be at least 3 characters."
        trimmed.length > 16 -> "Username must be at most 16 characters."
        !USERNAME_REGEX.matches(trimmed) -> "Use only letters, numbers and underscores."
        else -> null
    }
}

private fun validateEmailLocal(value: String): String? {
    val trimmed = value.trim()
    return when {
        trimmed.isEmpty() -> "Email is required."
        !EMAIL_REGEX.matches(trimmed) -> "Enter a valid email address."
        else -> null
    }
}

private fun validatePasswordLocal(value: String, username: String): String? {
    return when {
        value.isEmpty() -> "Password is required."
        value.length < 8 -> "Password must be at least 8 characters."
        value.length > 128 -> "Password must be at most 128 characters."
        !value.any { it.isLetter() } || !value.any { it.isDigit() } ->
            "Include at least one letter and one number."
        username.length >= 3 && value.contains(username, ignoreCase = true) ->
            "Password cannot contain your username."
        else -> null
    }
}
