package expo.modules.zerospikealarmkit

import android.app.AlarmManager
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android counterpart of ios/ZerospikeAlarmKitModule.swift, matching its
 * eight JS-visible functions (index.ts) exactly. There is no AlarmKit on
 * Android; this schedules AlarmManager.setAlarmClock alarms with a
 * full-screen-intent notification and a dedicated ring activity instead, but
 * the JS contract (same function names, same return shapes, same
 * "never throws, fall back to a plain notification" behaviour) is identical.
 *
 * ANDROID_ALARM_ENABLED is now ON, so the full surface (lock-screen ring
 * activity, boot re-arm, foreground sound service) is live. Setting it back
 * to false makes the whole module report "unavailable/false" again, exactly
 * as if this native module were not linked at all, and every reminder falls
 * back to a plain notification.
 */
// Bayrak ACIK. Kapatilirsa su uc izin app.json'dan da cikarilmali:
// USE_FULL_SCREEN_INTENT, RECEIVE_BOOT_COMPLETED, FOREGROUND_SERVICE.
// Kullanilmayan hassas izin Play'de bayrak yaratir.
private const val ANDROID_ALARM_ENABLED = true

class ZerospikeAlarmKitModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private var pendingAuthPromise: Promise? = null
  private var pendingAuthStage: Int = 0

  override fun definition() = ModuleDefinition {
    Name("ZerospikeAlarmKit")

    Function("isAvailable") {
      if (!ANDROID_ALARM_ENABLED) false else computeAvailability(context)
    }

    Function("getAuthorizationStatus") {
      if (!ANDROID_ALARM_ENABLED) "unavailable" else computeStatus(context)
    }

    AsyncFunction("requestAuthorization") { promise: Promise ->
      if (!ANDROID_ALARM_ENABLED) {
        promise.resolve("unavailable")
        return@AsyncFunction
      }
      AlarmStore.markRequestedAuthorization(context)
      beginAuthorizationFlow(promise)
    }

    AsyncFunction("scheduleDailyAlarm") {
        id: String,
        hour: Int,
        minute: Int,
        label: String,
        stopLabel: String,
        openLabel: String,
        route: String,
        promise: Promise ->
      if (!ANDROID_ALARM_ENABLED || !computeAvailability(context)) {
        promise.resolve(false)
        return@AsyncFunction
      }
      val record = AlarmRecord(
        id = id,
        isDaily = true,
        hour = hour,
        minute = minute,
        triggerAtMillis = AlarmScheduler.nextDailyTrigger(hour, minute),
        label = label,
        stopLabel = stopLabel,
        openLabel = openLabel,
        route = route
      )
      AlarmStore.save(context, record)
      val ok = AlarmScheduler.schedule(context, record)
      if (!ok) AlarmStore.remove(context, id)
      promise.resolve(ok)
    }

    AsyncFunction("scheduleOneShotAlarm") {
        id: String,
        epochSeconds: Double,
        label: String,
        stopLabel: String,
        openLabel: String,
        route: String,
        promise: Promise ->
      if (!ANDROID_ALARM_ENABLED || !computeAvailability(context)) {
        promise.resolve(false)
        return@AsyncFunction
      }
      val record = AlarmRecord(
        id = id,
        isDaily = false,
        hour = 0,
        minute = 0,
        triggerAtMillis = (epochSeconds * 1000).toLong(),
        label = label,
        stopLabel = stopLabel,
        openLabel = openLabel,
        route = route
      )
      AlarmStore.save(context, record)
      val ok = AlarmScheduler.schedule(context, record)
      if (!ok) AlarmStore.remove(context, id)
      promise.resolve(ok)
    }

    AsyncFunction("cancelAlarm") { id: String, promise: Promise ->
      if (!ANDROID_ALARM_ENABLED) {
        promise.resolve(false)
        return@AsyncFunction
      }
      AlarmScheduler.cancel(context, id)
      AlarmStore.remove(context, id)
      AlarmReceiver.cancelNotification(context, id)
      promise.resolve(true)
    }

    Function("listScheduledAlarmIds") {
      if (!ANDROID_ALARM_ENABLED) emptyList<String>() else AlarmStore.allIds(context)
    }

    // Returns { route, alarmId? } rather than the bare route string it used to
    // (iOS returns the same shape), so JS can open the exact reminder that
    // rang. `alarmId` is left out entirely - never an empty string - when the
    // ringing alarm carried no id.
    Function("takePendingAlarmRoute") {
      if (!ANDROID_ALARM_ENABLED) {
        null
      } else {
        AlarmStore.takePending(context)?.let { pending ->
          buildMap<String, String> {
            put("route", pending.route)
            pending.alarmId?.let { put("alarmId", it) }
          }
        }
      }
    }

    OnActivityEntersForeground {
      if (pendingAuthPromise != null) {
        continueAuthorizationFlow()
      }
    }
  }

  private fun canScheduleExact(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    return alarmManager.canScheduleExactAlarms()
  }

  private fun canUseFullScreenIntent(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return true
    val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    return notificationManager.canUseFullScreenIntent()
  }

  private fun computeAvailability(context: Context): Boolean =
    canScheduleExact(context) && canUseFullScreenIntent(context)

  private fun computeStatus(context: Context): String = when {
    computeAvailability(context) -> "authorized"
    !AlarmStore.hasRequestedAuthorization(context) -> "notDetermined"
    else -> "denied"
  }

  private fun exactAlarmSettingsIntent(): Intent =
    Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${context.packageName}"))
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

  private fun fullScreenIntentSettingsIntent(): Intent =
    Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${context.packageName}"))
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

  /** Android has no single system prompt for this (unlike iOS AlarmKit's
   *  own authorization dialog), so this chains the two settings screens the
   *  card calls for, one at a time, resolving only once both have been
   *  visited (or were not needed). */
  private fun beginAuthorizationFlow(promise: Promise) {
    val activity = appContext.currentActivity
    if (activity == null) {
      promise.resolve(computeStatus(context))
      return
    }
    if (!canScheduleExact(context)) {
      pendingAuthPromise = promise
      pendingAuthStage = 1
      activity.startActivity(exactAlarmSettingsIntent())
      return
    }
    if (!canUseFullScreenIntent(context)) {
      pendingAuthPromise = promise
      pendingAuthStage = 2
      activity.startActivity(fullScreenIntentSettingsIntent())
      return
    }
    promise.resolve(computeStatus(context))
  }

  private fun continueAuthorizationFlow() {
    val promise = pendingAuthPromise ?: return
    if (pendingAuthStage == 1 && !canUseFullScreenIntent(context)) {
      val activity = appContext.currentActivity
      if (activity == null) {
        pendingAuthPromise = null
        promise.resolve(computeStatus(context))
        return
      }
      pendingAuthStage = 2
      activity.startActivity(fullScreenIntentSettingsIntent())
      return
    }
    pendingAuthPromise = null
    promise.resolve(computeStatus(context))
  }
}
