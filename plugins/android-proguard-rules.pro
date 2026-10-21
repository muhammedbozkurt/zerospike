# R8 keep rules for the release build (android.enableMinifyInReleaseBuilds).
# Appended to android/app/proguard-rules.pro by plugins/withAndroidProguardRules.js.
# Not repeated here because the libraries ship their own consumer rules or
# annotations: RN core (its rule keeps com.facebook.jni.** used by the Hermes
# JNI), reanimated, worklets, expo-modules-core (Module, Record, Service),
# expo-notifications (its rule is `-keep class expo.modules.notifications.**
# {*;}`; firebase-messaging ships its own; notifee is not a dependency),
# expo-updates, expo-sqlite (@DoNotStrip JNI classes), nitro (@DoNotStrip),
# WorkManager workers and the dev.matinzd Health Connect records. The local
# modules/zerospike-* classes (alarm receivers, ring activity, sound service)
# are manifest components or expo Modules, both kept automatically, so no extra
# notification or alarm keep is needed.
# No -dontwarn: add one only after an R8 "Missing class" report names the class.

# Expo Records and kotlin.reflect type conversion read generic signatures and
# annotations at runtime.
-keepattributes Signature,InnerClasses,EnclosingMethod,*Annotation*
-keep class kotlin.Metadata { *; }

# Hermes: the engine's Java side (HermesExecutor and friends) is created from
# native code by name over JNI. RN's consumer rule only covers
# com.facebook.jni.**. Defensive.
-keep class com.facebook.hermes.** { *; }

# expo-modules-core loads the headless app loader with Class.forName from a
# manifest <meta-data> string (AppLoaderProvider). A meta-data value is not a
# component reference, so aapt does not keep it.
-keep class expo.modules.adapters.react.apploader.RNHeadlessAppLoader { <init>(); }

# expo-task-manager (under expo-background-task) stores the consumer class name
# in SharedPreferences and restores it with Class.forName plus this constructor
# (TaskService). A renamed class would orphan scheduled tasks after an update.
-keep class * extends expo.modules.interfaces.taskManager.TaskConsumer {
  <init>(android.content.Context, expo.modules.interfaces.taskManager.TaskManagerUtilsInterface);
}

# react-native-purchases (RevenueCat): hybrid-common turns SDK model classes
# into maps for the JS bridge. Defensive; narrow with mapping.txt later if the
# size gain matters.
-keep class com.revenuecat.purchases.** { *; }

# react-native-health-connect: the consumer rule covers its own records.**; the
# module hands androidx record classes (KClass table in HealthConnectUtils)
# to the Health Connect client. Defensive.
-keep class androidx.health.connect.client.records.** { *; }

# react-native-android-widget: provider, collection service, configuration
# activity and the WorkManager worker are instantiated by the OS or by
# WorkManager from stored class names. Defensive, the package is small.
-keep class com.reactnativeandroidwidget.** { *; }
