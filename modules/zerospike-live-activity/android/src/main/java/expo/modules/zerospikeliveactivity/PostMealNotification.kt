package expo.modules.zerospikeliveactivity

import android.content.Context
import android.content.Intent
import android.app.PendingIntent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Android's countdown surface for the post-meal timer - the closest
 * equivalent this platform has to the iOS Live Activity / Dynamic Island
 * (see ../ios/ZerospikeLiveActivityModule.swift).
 *
 * expo-notifications' own builder (ExpoNotificationBuilder.kt) only exposes
 * setOngoing - no chronometer, no ProgressStyle - so this posts straight
 * through NotificationManagerCompat instead of going through
 * expo-notifications at all. It shares the "postmeal-v1" channel
 * lib/services/notifications.ts creates (silent, IMPORTANCE_LOW): this
 * object never creates the channel itself, only posts to it, so if
 * ensureAndroidChannel has not run yet (should not happen - it runs at app
 * launch) the notify() call below just fails silently rather than crash.
 *
 * Baseline, API 26+ (this app's whole supported range): an ONGOING
 * notification using setUsesChronometer + setChronometerCountDown, driven
 * off the absolute `endsAtMs` the same way the OS's own Chronometer view
 * would be - no per-second tick from JS or native required, the system
 * draws and keeps drawing it even if this process is not running.
 *
 * On Android 16 QPR1+ ("Live Updates" - see applyLiveUpdatesIfSupported)
 * the same notification additionally asks to be promoted
 * (setRequestPromotedOngoing) and carries a NotificationCompat.ProgressStyle.
 * That half is best-effort and behind its own guard: any failure there must
 * never affect the baseline notification already built above it.
 */
object PostMealNotification {
  const val CHANNEL_ID = "postmeal-v1"
  private const val NOTIFICATION_ID = 725_301

  private const val PREFS_NAME = "zerospike_postmeal_notification"
  private const val KEY_ENDS_AT = "endsAt"
  private const val KEY_STARTED_AT = "startedAt"
  private const val KEY_TITLE = "title"

  /** Whether the countdown notification is currently posted. Queried from the
   *  system (not an in-memory flag) so it answers correctly even after this
   *  process was killed and restarted while the notification kept showing. */
  fun isActive(context: Context): Boolean = try {
    NotificationManagerCompat.from(context).activeNotifications.any { it.id == NOTIFICATION_ID }
  } catch (e: Throwable) {
    false
  }

  /** Posts (or replaces) the countdown. `title`/`lastReading`/`unitLabel`
   *  arrive already localized/formatted from JS - this draws no text of its
   *  own beyond joining the two. Persists the triple to SharedPreferences so
   *  [updateReading] can rebuild the same chronometer even if this process is
   *  restarted between [show] and the next reading. */
  fun show(
    context: Context,
    endsAtMs: Long,
    startedAtMs: Long,
    title: String,
    lastReading: String?,
    unitLabel: String
  ) {
    prefs(context).edit()
      .putLong(KEY_ENDS_AT, endsAtMs)
      .putLong(KEY_STARTED_AT, startedAtMs)
      .putString(KEY_TITLE, title)
      .apply()
    post(context, endsAtMs, startedAtMs, title, lastReading, unitLabel)
  }

  /** Refreshes ONLY the reading on an already-running countdown (mirrors the
   *  iOS `update` - never starts one). Returns false when nothing is posted,
   *  or when the persisted end/title could not be recovered (a notification
   *  survived a process restart, but this object's own record of it did
   *  not - should not happen since [show] always persists before posting,
   *  but a cleared/reinstalled app data store is not worth crashing over). */
  fun updateReading(context: Context, lastReading: String?, unitLabel: String): Boolean {
    if (!isActive(context)) return false
    val stored = prefs(context)
    val endsAtMs = stored.getLong(KEY_ENDS_AT, -1L)
    val startedAtMs = stored.getLong(KEY_STARTED_AT, -1L)
    val title = stored.getString(KEY_TITLE, null)
    if (endsAtMs <= 0L || title == null) return false
    post(context, endsAtMs, startedAtMs, title, lastReading, unitLabel)
    return true
  }

  /** Takes the countdown down (elapsed, cancelled, or logged early). */
  fun cancel(context: Context) {
    try {
      NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    } catch (e: Throwable) {
      // nothing posted
    }
    try {
      prefs(context).edit().clear().apply()
    } catch (e: Throwable) {
      // best-effort
    }
  }

  private fun prefs(context: Context) =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  private fun post(
    context: Context,
    endsAtMs: Long,
    startedAtMs: Long,
    title: String,
    lastReading: String?,
    unitLabel: String
  ) {
    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(resolveSmallIcon(context))
      .setContentTitle(title)
      .setContentText(bodyText(lastReading, unitLabel))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setShowWhen(true)
      .setWhen(endsAtMs)
      .setUsesChronometer(true)
      .setChronometerCountDown(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setAutoCancel(false)
      .setContentIntent(openAppIntent(context))

    applyLiveUpdatesIfSupported(builder, endsAtMs, startedAtMs)

    try {
      NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, builder.build())
    } catch (e: SecurityException) {
      // Notification permission missing or revoked mid-window - a stale
      // countdown surface must never break a reading/meal save.
    }
  }

  private fun bodyText(lastReading: String?, unitLabel: String): String? =
    if (lastReading.isNullOrBlank()) null else "$lastReading $unitLabel".trim()

  private fun openAppIntent(context: Context): PendingIntent? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    return PendingIntent.getActivity(
      context,
      NOTIFICATION_ID,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  private fun resolveSmallIcon(context: Context): Int {
    val fromApp = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
      .takeIf { it != 0 }
      ?: context.resources.getIdentifier("notification_icon", "mipmap", context.packageName).takeIf { it != 0 }
    return fromApp ?: android.R.drawable.ic_popup_reminder
  }

  /**
   * Android 16 QPR1's "Live Updates": a promoted, progress-bar-styled ongoing
   * notification (a status-bar/lock-screen chip), the closest this platform
   * gets to the iOS Live Activity/Dynamic Island this whole module mirrors.
   *
   * Gated on the MINOR sdk version (SDK_INT_FULL / VERSION_CODES_FULL - the
   * API Android introduced specifically for QPR-only features like this one),
   * read by reflection rather than by direct field reference: those symbols
   * did not exist before API 36 at all, and this file cannot be compiled
   * against a real API 36.1 SDK from this environment to confirm the exact
   * constant name, so a reflective, try/catch-wrapped lookup is the only way
   * to gate this that is guaranteed not to break either compilation or a
   * device below API 36.1 - see the is karti report's device-QA list.
   *
   * `setRequestPromotedOngoing`/`NotificationCompat.ProgressStyle` themselves
   * ARE compiled directly (not reflectively): androidx.core 1.17.0, already
   * on the classpath transitively through expo-modules-core, ships both.
   * Any failure below (this device's exact shape differing from what is
   * assumed here) is swallowed - the baseline chronometer notification built
   * by the caller is already complete on its own.
   */
  private fun applyLiveUpdatesIfSupported(
    builder: NotificationCompat.Builder,
    endsAtMs: Long,
    startedAtMs: Long
  ) {
    if (Build.VERSION.SDK_INT < 36) return
    if (!isQpr1OrLater()) return
    try {
      builder.setRequestPromotedOngoing(true)

      val total = (endsAtMs - startedAtMs).coerceAtLeast(1L)
      val elapsed = (System.currentTimeMillis() - startedAtMs).coerceIn(0L, total)
      val progress = ((elapsed.toDouble() / total.toDouble()) * 100).toInt().coerceIn(0, 100)

      val progressStyle = NotificationCompat.ProgressStyle()
        .setStyledByProgress(false)
        .setProgress(progress)
      builder.setStyle(progressStyle)
    } catch (e: Throwable) {
      // Best-effort only - see the class doc above.
    }
  }

  /** Reflective SDK_INT_FULL >= VERSION_CODES_FULL.BAKLAVA_1 check - see the
   *  doc on [applyLiveUpdatesIfSupported] for why this is not a direct
   *  reference. Both symbols were introduced together in API 36, so this is
   *  only ever reached once the outer `SDK_INT < 36` guard has already
   *  passed. */
  private fun isQpr1OrLater(): Boolean = try {
    val sdkIntFull = Build.VERSION::class.java.getField("SDK_INT_FULL").getInt(null)
    val versionCodesFull = Class.forName("android.os.Build\$VERSION_CODES_FULL")
    val baklava1 = versionCodesFull.getField("BAKLAVA_1").getInt(null)
    sdkIntFull >= baklava1
  } catch (e: Throwable) {
    false
  }
}
