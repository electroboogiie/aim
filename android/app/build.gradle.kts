import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

fun kpProperty(name: String, default: String): String =
    providers.gradleProperty(name).orNull?.trim()?.takeIf { it.isNotEmpty() } ?: default

val kpServerUrl = providers.gradleProperty("kp.serverUrl").orNull?.trim().orEmpty()
val kpVersionCode = kpProperty("kp.versionCode", "1").toInt()
val kpVersionName = kpProperty("kp.versionName", "0.1.0")

android {
    namespace = "ua.gidman.kp"
    compileSdk = 35

    defaultConfig {
        applicationId = "ua.gidman.kp"
        minSdk = 24
        targetSdk = 35
        versionCode = kpVersionCode
        versionName = kpVersionName
        val escaped = kpServerUrl.replace("\\", "\\\\").replace("\"", "\\\"")
        buildConfigField("String", "SERVER_URL", "\"$escaped\"")
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

tasks.withType<KotlinCompile>().configureEach {
    compilerOptions.jvmTarget.set(JvmTarget.JVM_17)
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
}
