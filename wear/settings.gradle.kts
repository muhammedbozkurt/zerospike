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

// Fully independent Gradle project: does NOT link into the phone app's
// android/settings.gradle. `expo prebuild --clean` only wipes android/ and
// ios/, so this project must survive every phone prebuild untouched.
rootProject.name = "zerospike-wear"
include(":app")
