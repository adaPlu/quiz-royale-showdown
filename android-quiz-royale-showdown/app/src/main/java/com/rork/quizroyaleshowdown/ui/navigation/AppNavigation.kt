package com.rork.quizroyaleshowdown.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.rork.quizroyaleshowdown.data.GameMode
import com.rork.quizroyaleshowdown.data.MatchViewModel
import com.rork.quizroyaleshowdown.data.PlayerPrefs
import com.rork.quizroyaleshowdown.ui.screens.HomeScreen
import com.rork.quizroyaleshowdown.ui.screens.MatchScreen

private const val ROUTE_HOME = "home"
private const val ROUTE_MATCH = "match/{mode}"

@Composable
fun AppNavigation() {
    val navController = rememberNavController()
    val context = LocalContext.current
    val prefs = remember { PlayerPrefs(context) }

    NavHost(
        navController = navController,
        startDestination = ROUTE_HOME
    ) {
        composable(ROUTE_HOME) {
            HomeScreen(
                prefs = prefs,
                onPlay = { mode -> navController.navigate("match/${mode.name}") }
            )
        }

        composable(
            route = ROUTE_MATCH,
            arguments = listOf(navArgument("mode") { type = NavType.StringType })
        ) { entry ->
            val raw = entry.arguments?.getString("mode") ?: GameMode.QUICK.name
            val mode = runCatching { GameMode.valueOf(raw) }.getOrDefault(GameMode.QUICK)
            // Scoped to this destination so leaving the match tears the socket down.
            val viewModel: MatchViewModel = viewModel()

            MatchScreen(
                mode = mode,
                viewModel = viewModel,
                onExit = {
                    navController.popBackStack(ROUTE_HOME, inclusive = false)
                }
            )
        }
    }
}
