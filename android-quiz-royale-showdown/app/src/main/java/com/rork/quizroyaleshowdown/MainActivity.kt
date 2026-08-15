package com.rork.quizroyaleshowdown

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import com.rork.quizroyaleshowdown.ui.navigation.AppNavigation
import com.rork.quizroyaleshowdown.ui.theme.Arena
import com.rork.quizroyaleshowdown.ui.theme.AppTheme
import androidx.compose.foundation.layout.Box

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            AppTheme {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Arena.Canvas)
                ) {
                    AppNavigation()
                }
            }
        }
    }
}
