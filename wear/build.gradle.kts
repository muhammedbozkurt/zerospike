// Root build file: declares plugin versions once, applied (without a version)
// by app/build.gradle.kts. No android/build.gradle classpath entanglement with
// the phone project - this tree never reads or writes anything under android/.
plugins {
    id("com.android.application") version "8.9.0" apply false
    id("org.jetbrains.kotlin.android") version "2.1.0" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.1.0" apply false
}
