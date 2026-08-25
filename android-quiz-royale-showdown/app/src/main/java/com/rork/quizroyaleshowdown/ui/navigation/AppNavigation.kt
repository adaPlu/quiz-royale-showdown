package com.rork.quizroyaleshowdown.ui.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LocalMall
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Stars
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.rork.quizroyaleshowdown.data.AppearanceViewModel
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
import com.rork.quizroyaleshowdown.ui.screens.PlayScreen
import com.rork.quizroyaleshowdown.ui.screens.ProfileScreenWithAppearance
import com.rork.quizroyaleshowdown.ui.screens.SeasonScreen
import com.rork.quizroyaleshowdown.ui.screens.StoreScreen
import com.rork.quizroyaleshowdown.ui.theme.Arena

private const val ROUTE_HOME = "home"
private const val ROUTE_PLAY = "play"
private const val ROUTE_AUTH = "auth/{mode}"
private const val ROUTE_PROFILE = "profile"
private const val ROUTE_LEADERBOARD = "leaderboard"
private const val ROUTE_STORE = "store"
private const val ROUTE_SEASON = "season"
private const val ROUTE_MATCH = "match/{mode}"

private data class MainDestination(
    val route: String,
    val label: String,
    val icon: ImageVector
)

private val MAIN_DESTINATIONS = listOf(
    MainDestination(ROUTE_HOME, "HOME", Icons.Filled.Home),
    MainDestination(ROUTE_PLAY, "PLAY", Icons.Filled.PlayArrow),
    MainDestination(ROUTE_STORE, "STORE", Icons.Filled.LocalMall),
    MainDestination(ROUTE_SEASON, "SEASON", Icons.Filled.Stars),
    MainDestination(ROUTE_PROFILE, "PROFILE", Icons.Filled.Person)
)

@Composable
fun AppNavigation() {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route

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

    // The persistent main nav is deliberately hidden only for focused auth and
    // active-match flows. Everywhere else, Store remains one tap away.
    val showMainNavigation = currentRoute != null &&
        !currentRoute.startsWith("match") &&
        !currentRoute.startsWith("auth")

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
        Scaffold(
            modifier = Modifier.fillMaxSize(),
            containerColor = Color.Transparent,
            contentWindowInsets = WindowInsets(0, 0, 0, 0),
            bottomBar = {
                if (showMainNavigation) {
                    MainNavigationBar(
                        currentRoute = currentRoute,
                        onNavigate = { route ->
                            if (route != currentRoute) {
                                navController.navigate(route) {
                                    launchSingleTop = true
                                    restoreState = true
                                    popUpTo(ROUTE_HOME) { saveState = true }
                                }
                            }
                        }
                    )
                }
            }
        ) { contentPadding ->
            NavHost(
                navController = navController,
                startDestination = ROUTE_HOME,
                modifier = Modifier.padding(contentPadding)
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

                composable(ROUTE_PLAY) {
                    PlayScreen(
                        onPlay = { mode -> navController.navigate("match/${mode.name}") }
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
                            navController.popBackStack(ROUTE_HOME, inclusive = false)
                        },
                        onBack = { navController.popBackStack() }
                    )
                }

                composable(ROUTE_PROFILE) {
                    val appearanceViewModel: AppearanceViewModel = viewModel()
                    ProfileScreenWithAppearance(
                        viewModel = authViewModel,
                        appearanceViewModel = appearanceViewModel,
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
                    val matchViewModel: MatchViewModel = viewModel()

                    LifecycleResumeEffect(mode) {
                        authViewModel.setInMatch(mode)
                        onPauseOrDispose { authViewModel.setInMatch(null) }
                    }

                    MatchScreen(
                        mode = mode,
                        viewModel = matchViewModel,
                        onExit = {
                            authViewModel.refresh()
                            navController.popBackStack(ROUTE_HOME, inclusive = false)
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun MainNavigationBar(
    currentRoute: String?,
    onNavigate: (String) -> Unit
) {
    NavigationBar(
        containerColor = Arena.Canvas,
        contentColor = Arena.TextHi
    ) {
        MAIN_DESTINATIONS.forEach { destination ->
            val selected = currentRoute == destination.route
            NavigationBarItem(
                selected = selected,
                onClick = { onNavigate(destination.route) },
                icon = {
                    Icon(
                        imageVector = destination.icon,
                        contentDescription = destination.label
                    )
                },
                label = { Text(destination.label) },
                alwaysShowLabel = true,
                colors = NavigationBarItemDefaults.colors(
                    selectedIconColor = Arena.GoldBright,
                    selectedTextColor = Arena.GoldBright,
                    indicatorColor = Arena.Gold.copy(alpha = 0.16f),
                    unselectedIconColor = Arena.TextLow,
                    unselectedTextColor = Arena.TextLow
                )
            )
        }
    }
}
