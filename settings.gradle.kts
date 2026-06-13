pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "LumenVpn"
include(":app")
include(":desktop")
include(":amnezia-utils")
include(":amnezia-protocol-api")
include(":amnezia-openvpn")
