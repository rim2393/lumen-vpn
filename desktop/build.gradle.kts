plugins {
    id("org.jetbrains.kotlin.jvm")
    id("org.jetbrains.kotlin.plugin.serialization")
    application
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

application {
    mainClass.set("tel.lumentech.vpn.desktop.WindowsAppKt")
    applicationName = "lumen-vpn"
}

distributions {
    main {
        contents {
            from("packaging/service") { into("service") }
            from("packaging/runtime") { into("runtime") }
            from("packaging/jre") { into("jre") }
            from("packaging/wix") { into("wix") }
        }
    }
}

dependencies {
    implementation("com.squareup.okhttp3:okhttp:5.1.0")
    implementation("com.google.zxing:javase:3.5.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
    testImplementation("junit:junit:4.13.2")
}

tasks.register<JavaExec>("runLiveQa") {
    group = "verification"
    description = "Parse and validate live subscriptions from a local file without printing secrets."
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("tel.lumentech.vpn.desktop.LiveSubscriptionQaKt")
    workingDir = rootProject.projectDir
}

tasks.register<JavaExec>("runElevatedTunnelQa") {
    group = "verification"
    description = "Start each imported Windows VPN runtime sequentially; must be run from an elevated shell."
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("tel.lumentech.vpn.desktop.ElevatedTunnelQaKt")
    workingDir = rootProject.projectDir
}

kotlin {
    sourceSets {
        main {
            kotlin.srcDirs(
                "src/main/kotlin",
                "../app/src/main/java/tel/lumentech/vpn/model",
                "../app/src/main/java/tel/lumentech/vpn/subscription",
                "../app/src/main/java/tel/lumentech/vpn/runtime",
                "../app/src/main/java/tel/lumentech/vpn/security",
                "../app/src/main/java/tel/lumentech/vpn/auth"
            )
            kotlin.exclude("SecureTokenStore.kt")
            kotlin.exclude("TelegramAuthActivity.kt")
        }
    }
}
