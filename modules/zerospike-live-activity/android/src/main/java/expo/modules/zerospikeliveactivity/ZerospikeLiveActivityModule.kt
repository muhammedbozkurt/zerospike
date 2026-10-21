package expo.modules.zerospikeliveactivity

import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android counterpart of ../ios/ZerospikeLiveActivityModule.swift, matching
 * its JS-visible functions (index.ts) exactly.
 *
 * There is no ActivityKit on Android; PostMealNotification.kt posts a plain
 * ongoing/chronometer notification instead (optionally "promoted" on Android
 * 16 QPR1+ - see that file), but the JS contract - same function names, same
 * return shapes, same "never throws, degrade quietly" behaviour - is
 * identical.
 */
class ZerospikeLiveActivityModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ZerospikeLiveActivity")

    // Installed while the module registry is built, before the JS bundle runs,
    // so a fatal error during JS start-up is covered (FatalReportStore.kt).
    OnCreate {
      appContext.reactContext?.let { FatalReportStore.install(it) }
    }

    /** The last fatal report as a JSON string, or null when there is none. */
    Function("getLastFatalReport") {
      appContext.reactContext?.let { FatalReportStore.read(it) }
    }

    /** Deletes the stored report. True when nothing is left. */
    Function("clearLastFatalReport") {
      appContext.reactContext?.let { FatalReportStore.clear(it) } ?: false
    }

    /** Whether the OS will actually let a notification through right now -
     *  the Android analogue of iOS's ActivityAuthorizationInfo check. Does
     *  not inspect the postmeal-v1 channel specifically: a user who disabled
     *  notifications app-wide is the case this exists to catch, same as the
     *  iOS side only checks the OS-wide Live Activities toggle. */
    Function("isAvailable") {
      isNotificationAvailable()
    }

    /** Starts (or updates) the post-meal countdown notification. `endsAtMs`/
     *  `startedAtMs` are epoch ms, the same clock the JS timer uses. */
    AsyncFunction("start") {
        endsAtMs: Double,
        startedAtMs: Double,
        title: String,
        lastReading: String?,
        unitLabel: String,
        promise: Promise ->
      if (!isNotificationAvailable()) {
        promise.resolve(false)
        return@AsyncFunction
      }
      PostMealNotification.show(
        context,
        endsAtMs.toLong(),
        startedAtMs.toLong(),
        title,
        lastReading,
        unitLabel
      )
      promise.resolve(true)
    }

    /** Refreshes ONLY the reading on a RUNNING countdown, leaving its end
     *  untouched. Never starts one - resolves false when nothing is posted,
     *  which is the normal case for a plain glucose reading. */
    AsyncFunction("update") { lastReading: String?, unitLabel: String, promise: Promise ->
      promise.resolve(PostMealNotification.updateReading(context, lastReading, unitLabel))
    }

    /** Ends the countdown notification (elapsed, cancelled, or logged early). */
    AsyncFunction("end") { promise: Promise ->
      PostMealNotification.cancel(context)
      promise.resolve(null)
    }

    /** Unreachable from JS on Android today: index.ts answers
     *  isWidgetInstalled() from react-native-android-widget before ever
     *  consulting this native module (see its own Platform.OS branch) - kept
     *  only so this module exposes the same JS-visible shape as the iOS
     *  side and never throws if that ever changes. */
    AsyncFunction("isWidgetInstalled") { promise: Promise ->
      promise.resolve(null)
    }
  }

  private fun isNotificationAvailable(): Boolean = try {
    NotificationManagerCompat.from(context).areNotificationsEnabled()
  } catch (e: Throwable) {
    false
  }
}
