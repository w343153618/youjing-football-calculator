plugins {
  alias(libs.plugins.android.application)
}

val isReleaseTaskRequested = gradle.startParameter.taskNames.any {
  it.contains("Release", ignoreCase = true)
}

android {
  namespace = "io.yjty.jisuanqi"
  compileSdk = 36

  defaultConfig {
    applicationId = "io.yjty.jisuanqi"
    minSdk = 26
    targetSdk = 36
    versionCode = 240
    versionName = "2.4.0"
  }

  signingConfigs {
    create("release") {
      val ksPath = System.getenv("YJ_KEYSTORE_FILE")
      if (!ksPath.isNullOrBlank() && file(ksPath).exists()) {
        storeFile = file(ksPath)
        storePassword = System.getenv("YJ_KEYSTORE_PASSWORD") ?: ""
        keyAlias = System.getenv("YJ_KEY_ALIAS") ?: "youjing"
        keyPassword = System.getenv("YJ_KEY_PASSWORD") ?: ""
        enableV1Signing = false
        enableV2Signing = true
        enableV3Signing = true
      } else if (isReleaseTaskRequested) {
        throw GradleException("YJ_KEYSTORE_FILE must be provided for signed Release APK builds")
      }
    }
  }

  buildTypes {
    release {
      isDebuggable = false
      isMinifyEnabled = true
      isShrinkResources = true
      signingConfig = signingConfigs.getByName("release")
      proguardFiles(
        getDefaultProguardFile("proguard-android-optimize.txt"),
        "proguard-rules.pro"
      )
    }
    debug {
      isMinifyEnabled = false
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  buildFeatures {
    compose = false
    aidl = false
    buildConfig = false
    shaders = false
  }
}

kotlin {
  jvmToolchain(21)
}
