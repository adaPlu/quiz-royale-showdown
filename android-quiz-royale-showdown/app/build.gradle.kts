plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

val releaseBuildRequested = gradle.startParameter.taskNames.any { it.contains("Release", ignoreCase = true) }
fun environmentValue(name: String): String =
    providers.environmentVariable(name).orNull?.trim().orEmpty()

fun secretEnvironmentValue(name: String): String =
    providers.environmentVariable(name).orNull.orEmpty()

val releaseSigningRequired = environmentValue("ANDROID_RELEASE_SIGNING_REQUIRED").equals("true", ignoreCase = true)
val releaseKeystorePath = environmentValue("ANDROID_KEYSTORE_PATH")
val releaseKeystorePassword = secretEnvironmentValue("ANDROID_KEYSTORE_PASSWORD")
val releaseKeyAlias = environmentValue("ANDROID_KEY_ALIAS")
val releaseKeyPassword = secretEnvironmentValue("ANDROID_KEY_PASSWORD")
val releaseSigningConfigured =
    releaseKeystorePath.isNotBlank() &&
        releaseKeystorePassword.isNotEmpty() &&
        releaseKeyAlias.isNotBlank() &&
        releaseKeyPassword.isNotEmpty()
val releaseKeystoreFile = releaseKeystorePath.takeIf { it.isNotBlank() }?.let(::file)

if (releaseSigningRequired && !releaseSigningConfigured) {
    throw GradleException(
        "Signed release requested but ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, " +
            "ANDROID_KEY_ALIAS, or ANDROID_KEY_PASSWORD is missing."
    )
}
if (releaseSigningRequired && releaseKeystoreFile?.isFile != true) {
    throw GradleException("ANDROID_KEYSTORE_PATH does not point to a readable keystore file.")
}

fun configuredValue(name: String, defaultValue: String): String =
    providers.gradleProperty(name)
        .orElse(providers.environmentVariable(name))
        .getOrElse(if (releaseBuildRequested) "" else defaultValue)

fun requireReleaseValue(name: String, value: String) {
    if (releaseBuildRequested && value.isBlank()) {
        throw GradleException("$name must be configured for release builds.")
    }
}

fun String.toBuildConfigLiteral(): String =
    "\"" + replace("\\", "\\\\").replace("\"", "\\\"") + "\""

val railwayApiUrl = configuredValue(
    "EXPO_PUBLIC_RAILWAY_API_URL",
    "https://railway-api-production-5772.up.railway.app"
)
val rorkFunctionsUrl = configuredValue(
    "EXPO_PUBLIC_RORK_FUNCTIONS_URL",
    "https://quiz-royale-functions.adapluguez.workers.dev"
)
requireReleaseValue("EXPO_PUBLIC_RAILWAY_API_URL", railwayApiUrl)
requireReleaseValue("EXPO_PUBLIC_RORK_FUNCTIONS_URL", rorkFunctionsUrl)

android {
    namespace = "com.rork.quizroyaleshowdown"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.rork.quizroyaleshowdown"
        minSdk = 26
        targetSdk = 36
        versionCode = 1787428688
        versionName = "1.9"
        buildConfigField("String", "EXPO_PUBLIC_RAILWAY_API_URL", railwayApiUrl.toBuildConfigLiteral())
        buildConfigField("String", "EXPO_PUBLIC_RORK_FUNCTIONS_URL", rorkFunctionsUrl.toBuildConfigLiteral())
    }

    signingConfigs {
        if (releaseSigningConfigured) {
            create("release") {
                storeFile = releaseKeystoreFile
                storePassword = releaseKeystorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        release {
            if (releaseSigningConfigured) {
                signingConfig = signingConfigs.getByName("release")
            }
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
    implementation(libs.google.play.billing)

    testImplementation("junit:junit:4.13.2")
    debugImplementation(libs.androidx.ui.tooling)
}
