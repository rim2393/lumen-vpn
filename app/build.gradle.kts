import java.util.Properties
import org.gradle.api.tasks.bundling.Zip

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("com.google.devtools.ksp")
}

val signingPropertiesFile = rootProject.file(".tooling/signing.properties")
val signingProperties = Properties().apply {
    if (signingPropertiesFile.exists()) {
        signingPropertiesFile.inputStream().use(::load)
    }
}

android {
    namespace = "tel.lumentech.vpn"
    compileSdk = 36

    defaultConfig {
        applicationId = "tel.lumentech.vpn"
        minSdk = 26
        targetSdk = 36
        versionCode = 217
        versionName = "0.1.117"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables.useSupportLibrary = true
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += setOf(
                "META-INF/AL2.0",
                "META-INF/LGPL2.1",
                "META-INF/INDEX.LIST",
                "META-INF/io.netty.versions.properties"
            )
        }
        jniLibs {
            useLegacyPackaging = true
        }
    }

    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "armeabi-v7a", "x86", "x86_64")
            isUniversalApk = true
        }
    }

    signingConfigs {
        create("releaseUpload") {
            if (signingPropertiesFile.exists()) {
                storeFile = file(signingProperties.getProperty("storeFile"))
                storePassword = signingProperties.getProperty("storePassword")
                keyAlias = signingProperties.getProperty("keyAlias")
                keyPassword = signingProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            if (signingPropertiesFile.exists()) {
                signingConfig = signingConfigs.getByName("releaseUpload")
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlin {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

val writeHiddifyCoreManifest by tasks.registering {
    val output = layout.buildDirectory.file("generated/hiddify-core/AndroidManifest.xml")
    outputs.file(output)
    doLast {
        val manifest = output.get().asFile
        manifest.parentFile.mkdirs()
        manifest.writeText("""<manifest xmlns:android="http://schemas.android.com/apk/res/android"/>""")
    }
}

val prepareHiddifyCoreAar by tasks.registering(Zip::class) {
    val upstreamAar = layout.projectDirectory.file("libs/hiddify-core.aar")
    val sanitizedManifest = layout.buildDirectory.file("generated/hiddify-core/AndroidManifest.xml")

    dependsOn(writeHiddifyCoreManifest)
    from(zipTree(upstreamAar)) {
        exclude("AndroidManifest.xml")
    }
    from(sanitizedManifest) {
        rename { "AndroidManifest.xml" }
    }
    archiveFileName.set("hiddify-core-sanitized.aar")
    destinationDirectory.set(layout.buildDirectory.dir("generated/hiddify-core"))
}

val hiddifyCoreAar = files(prepareHiddifyCoreAar.flatMap { it.archiveFile }).builtBy(prepareHiddifyCoreAar)

dependencies {
    implementation(hiddifyCoreAar)
    implementation(project(":amnezia-openvpn"))
    implementation("com.zaneschepke:amneziawg-android:2.3.7")

    implementation(platform("androidx.compose:compose-bom:2025.10.01"))
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4")

    implementation("androidx.datastore:datastore-preferences:1.1.7")
    implementation("androidx.security:security-crypto:1.1.0")

    implementation("androidx.room:room-runtime:2.8.3")
    implementation("androidx.room:room-ktx:2.8.3")
    ksp("androidx.room:room-compiler:2.8.3")

    implementation("com.squareup.okhttp3:okhttp:5.1.0")
    implementation("com.squareup.okhttp3:okhttp-dnsoverhttps:5.1.0")
    implementation("com.squareup.okhttp3:logging-interceptor:5.1.0")
    implementation("com.squareup.retrofit2:retrofit:3.0.0")
    implementation("com.squareup.retrofit2:converter-kotlinx-serialization:3.0.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")

    implementation("com.google.mlkit:barcode-scanning:17.3.0")
    implementation("androidx.camera:camera-camera2:1.5.0")
    implementation("androidx.camera:camera-lifecycle:1.5.0")
    implementation("androidx.camera:camera-view:1.5.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20260522")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    testImplementation("androidx.room:room-testing:2.8.3")
    debugImplementation("androidx.compose.ui:ui-tooling")
}
