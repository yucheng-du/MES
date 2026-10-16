plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.mesnext.hardware"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.mesnext.hardware"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    flavorDimensions += "printer"
    productFlavors {
        create("community") { dimension = "printer" }
        create("vendor") {
            dimension = "printer"
            ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") }
        }
    }
    // Both languages must remain installed for the in-app switch, including app bundles.
    bundle { language { enableSplit = false } }
    buildTypes {
        debug { applicationIdSuffix = ".debug" }
        release {
            // Vendor SDK uses reflection and JNI. Enable R8 only after device verification.
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    testOptions { unitTests.isReturnDefaultValues = false }
    packaging { jniLibs.useLegacyPackaging = true }
    lint {
        abortOnError = true
        checkReleaseBuilds = true
    }
}

// Vendor variants are opt-in; a fresh public checkout builds without proprietary binaries.
androidComponents {
    beforeVariants(selector().withFlavor("printer" to "vendor")) { variant ->
        variant.enable = providers.gradleProperty("withVendorSdk").orNull == "true"
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    implementation("com.google.zxing:core:3.5.3")
    "vendorImplementation"(files("libs/jc-printer-3.2.8.aar", "libs/jc-image-1.8.7.aar", "libs/LPAPI-2019-11-20-R.jar"))
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
