import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.greeneyeapp.zerospike.wear"
    compileSdk = 36

    defaultConfig {
        // Same package as the phone app on purpose: this is the standalone
        // Wear OS 2+ companion of com.greeneyeapp.zerospike, shipped as its
        // own AAB, never through the phone's android/ build.
        applicationId = "com.greeneyeapp.zerospike"
        minSdk = 30
        targetSdk = 36
        // Fully independent of the phone's versionCode (currently 60). Starts
        // at 100000 so the two build lineages can never collide on Play.
        versionCode = 100001
        versionName = "2.3.1"
    }

    // Play, ayni paket adiyla yuklenen her artifact'i AYNI upload key ile
    // imzalanmis gormek zorunda. Telefon tarafinin anahtari EAS'te duruyor:
    //   eas credentials --platform android   ->  keystore'u disari aktar
    // Sonra wear/keystore.properties dosyasini doldur (gitignore'da):
    //   storeFile=/mutlak/yol/upload.jks
    //   storePassword=...
    //   keyAlias=...
    //   keyPassword=...
    signingConfigs {
        create("upload") {
            val props = Properties()
            val f = rootProject.file("keystore.properties")
            if (f.exists()) {
                f.inputStream().use { props.load(it) }
                storeFile = file(props.getProperty("storeFile"))
                storePassword = props.getProperty("storePassword")
                keyAlias = props.getProperty("keyAlias")
                keyPassword = props.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Anahtar yoksa Gradle varsayilan olarak IMZASIZ birakir ve Play
            // reddeder; hatayi build zamaninda ve anlasilir sekilde verelim.
            if (rootProject.file("keystore.properties").exists()) {
                signingConfig = signingConfigs.getByName("upload")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }
}

dependencies {
    // Pinned per the work card - do not change.
    implementation("com.google.android.gms:play-services-wearable:20.0.1")
    implementation("androidx.wear.compose:compose-material3:1.6.2")
    implementation("androidx.wear.tiles:tiles:1.6.2")
    implementation("androidx.wear.watchface:watchface-complications-data-source-ktx:1.3.0")

    // Compile glue not covered by the pinned list above: Compose needs an
    // Activity host, and the Tiles ListenableFuture callbacks need a
    // non-Guava way to construct a ListenableFuture.
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.core:core-splashscreen:1.2.0")
    implementation("androidx.concurrent:concurrent-futures-ktx:1.1.0")
}
