plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "io.github.dabaneghassan.spur"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // The permanent app ID: it can never change once spur is on F-Droid.
        applicationId = "io.github.dabaneghassan.spur"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Both come from the version line in pubspec.yaml (versionName+versionCode).
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    buildTypes {
        release {
            // GitHub Actions re-signs the APK with the spur key when it is configured.
            // F-Droid removes this line and signs its own builds.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    // No encrypted dependency list for Google in the APK: F-Droid does not accept it,
    // and it is nobody else's business.
    dependenciesInfo {
        includeInApk = false
        includeInBundle = false
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
