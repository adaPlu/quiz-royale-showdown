plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

val releaseBuildRequested = gradle.startParameter.taskNames.any { it.contains("Release", ignoreCase = true) }
fun configuredValue(name: String): String =
    providers.gradleProperty(name).orElse(providers.environmentVariable(name)).getOrElse("")

fun requireReleaseValue(name: String, value: String) {
    if (releaseBuildRequested && value.isBlank()) {
        throw GradleException("$name must be configured for release builds.")
    }
}

fun String.toBuildConfigLiteral(): String =
    "\"" + replace("\\", "\\\\").replace("\"", "\\\"") + "\""

val railwayApiUrl = configuredValue("EXPO_PUBLIC_RAILWAY_API_URL")
val rorkFunctionsUrl = configuredValue("EXPO_PUBLIC_RORK_FUNCTIONS_URL")
requireReleaseValue("EXPO_PUBLIC_RAILWAY_API_URL", railwayApiUrl)
requireReleaseValue("EXPO_PUBLIC_RORK_FUNCTIONS_URL", rorkFunctionsUrl)

android {
    namespace = "com.rork.quizroyaleshowdown"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.rork.quizroyaleshowdown"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        buildConfigField("String", "EXPO_PUBLIC_RAILWAY_API_URL", railwayApiUrl.toBuildConfigLiteral())
        buildConfigField("String", "EXPO_PUBLIC_RORK_FUNCTIONS_URL", rorkFunctionsUrl.toBuildConfigLiteral())
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_11)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.security.crypto)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.ktor.client.core)
    implementation(libs.ktor.client.android)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.ktor.client.websockets)
    implementation(libs.ktor.client.content.negotiation)
    implementation(libs.ktor.serialization.json)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(libs.koin.androidx.compose)
    debugImplementation(libs.androidx.ui.tooling)
}
