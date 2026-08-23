package com.rork.quizroyaleshowdown.ui.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.rork.quizroyaleshowdown.data.AuthViewModel
import com.rork.quizroyaleshowdown.data.GameMode
import com.rork.quizroyaleshowdown.data.LeaderboardViewModel
import com.rork.quizroyaleshowdown.data.MatchViewModel
import com.rork.quizroyaleshowdown.data.SeasonViewModel
import com.rork.quizroyaleshowdown.data.StoreViewModel
import com.rork.quizroyaleshowdown.ui.screens.AuthMode
import com.rork.quizroyaleshowdown.ui.screens.AuthScreen
import com.rork.quizroyaleshowdown.ui.screens.HomeScreen
import com.rork.quizroyaleshowdown.ui.screens.LeaderboardScreen
import com.rork.quizroyaleshowdown.ui.screens.MatchScreen
import com.rork.quizroyaleshowdown.ui.screens.ProfileScreen
import com.rork.quizroyaleshowdown.ui.screens.SeasonScreen
import com.rork.quizroyaleshowdown.ui.screens.StoreScreen

private const val ROUTE_HOME = "home"
private const val ROUTE_AUTH = "auth/{mode}"
private const val ROUTE_PROFILE = "profile"
private const val ROUTE_LEADERBOARD = "leaderboard"
private const val ROUTE_STORE = "store"
private const val ROUTE_SEASON = "season"
private const val ROUTE_MATCH = "match/{mode}"

@Composable
fun AppNavigation() {
    val navController = rememberNavController()

    // Hoisted to the activity scope so every screen reads one identity, and a
    // register/login on the auth screen is instantly visible on the home screen.
    val authViewModel: AuthViewModel = viewModel()

    // Keep-alive and presence loops run only while the app is actually visible.
    // A backgrounded app must not hold a guest id alive — otherwise the 30-minute
    // idle limit would never be reached and the warning could never appear.
    LifecycleResumeEffect(authViewModel) {
        authViewModel.onForeground()
        onPauseOrDispose { authViewModel.onBackground() }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            // Any touch anywhere counts as activity. Observed in the Initial pass
            // so it never consumes the event or interferes with child gestures.
            .pointerInput(Unit) {
                awaitPointerEventScope {
                    while (true) {
                        awaitPointerEvent(PointerEventPass.Initial)
                        authViewModel.noteActivity()
                    }
                }
            }
    ) {
        NavHost(
            navController = navController,
            startDestination = ROUTE_HOME
        ) {
            composable(ROUTE_HOME) {
                HomeScreen(
                    authViewModel = authViewModel,
                    onPlay = { mode -> navController.navigate("match/${mode.name}") },
                    onRegister = { navController.navigate("auth/${AuthMode.REGISTER.name}") },
                    onSignIn = { navController.navigate("auth/${AuthMode.LOGIN.name}") },
                    onLeaderboard = { navController.navigate(ROUTE_LEADERBOARD) },
                    onStore = { navController.navigate(ROUTE_STORE) },
                    onSeason = { navController.navigate(ROUTE_SEASON) },
                    onProfile = { navController.navigate(ROUTE_PROFILE) }
                )
            }

            composable(
                route = ROUTE_AUTH,
                arguments = listOf(navArgument("mode") { type = NavType.StringType })
            ) { entry ->
                val raw = entry.arguments?.getString("mode") ?: AuthMode.REGISTER.name
                val mode = runCatching { AuthMode.valueOf(raw) }.getOrDefault(AuthMode.REGISTER)

                AuthScreen(
                    viewModel = authViewModel,
                    initialMode = mode,
                    onDone = {
                        // Land back on the home screen, now signed in.
                        navController.popBackStack(ROUTE_HOME, inclusive = false)
                    },
                    onBack = { navController.popBackStack() }
                )
            }

            composable(ROUTE_PROFILE) {
                ProfileScreen(
                    viewModel = authViewModel,
                    onBack = { navController.popBackStack() },
                    onRegister = { navController.navigate("auth/${AuthMode.REGISTER.name}") }
                )
            }

            composable(ROUTE_LEADERBOARD) {
                val leaderboardViewModel: LeaderboardViewModel = viewModel()
                LeaderboardScreen(
                    viewModel = leaderboardViewModel,
                    onBack = { navController.popBackStack() }
                )
            }

            composable(ROUTE_STORE) {
                val storeViewModel: StoreViewModel = viewModel()
                StoreScreen(
                    viewModel = storeViewModel,
                    onBack = { navController.popBackStack() },
                    onRegister = { navController.navigate("auth/${AuthMode.REGISTER.name}") }
                )
            }

            composable(ROUTE_SEASON) {
                val seasonViewModel: SeasonViewModel = viewModel()
                SeasonScreen(
                    viewModel = seasonViewModel,
                    onBack = { navController.popBackStack() },
                    onRegister = { navController.navigate("auth/${AuthMode.REGISTER.name}") }
                )
            }

            composable(
                route = ROUTE_MATCH,
                arguments = listOf(navArgument("mode") { type = NavType.StringType })
            ) { entry ->
                val raw = entry.arguments?.getString("mode") ?: GameMode.QUICK.name
                val mode = runCatching { GameMode.valueOf(raw) }.getOrDefault(GameMode.QUICK)
                // Scoped to this destination so leaving the match tears the socket down.
                val matchViewModel: MatchViewModel = viewModel()

                // Keep the presence poll alive while the match screen is visible.
                // The match room is the only authoritative IN_MATCH writer.
                LifecycleResumeEffect(mode) {
                    authViewModel.setInMatch(mode)
                    onPauseOrDispose { authViewModel.setInMatch(null) }
                }

                MatchScreen(
                    mode = mode,
                    viewModel = matchViewModel,
                    onExit = {
                        // Stats are written server-side as the match settles, so pull
                        // the fresh record before the home screen renders again.
                        authViewModel.refresh()
                        navController.popBackStack(ROUTE_HOME, inclusive = false)
                    }
                )
            }
        }
    }
}
