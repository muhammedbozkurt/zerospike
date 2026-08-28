package expo.modules.zerospikealarmkit

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Fires when AlarmManager wakes the app for one entry (daily or one-shot).
 * Builds a full-screen-intent notification rather than starting
 * AlarmRingActivity directly - the documented way to reliably show a
 * full-screen UI on a locked/background app from API 29+, and the reason
 * USE_FULL_SCREEN_INTENT is requested at all.
 */
class AlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = AlarmScheduler.extractAlarmId(intent) ?: return
    val record = AlarmStore.get(context, id) ?: return

    postFullScreenNotification(context, record)
    context.startForegroundService(AlarmSoundService.startIntent(context, record.id))

    if (record.isDaily) {
      val rearmed = record.copy(triggerAtMillis = AlarmScheduler.nextDailyTrigger(record.hour, record.minute))
      AlarmStore.save(context, rearmed)
      AlarmScheduler.schedule(context, rearmed)
    } else {
      AlarmStore.remove(context, id)
    }
  }

  private fun postFullScreenNotification(context: Context, record: AlarmRecord) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    ensureChannel(manager)

    val ringIntent = AlarmRingActivity.launchIntent(context, record)
    val ringPendingIntent = PendingIntent.getActivity(
      context,
      record.id.hashCode(),
      ringIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val notification = Notification.Builder(context, CHANNEL_ID)
      .setContentTitle(record.label)
      .setSmallIcon(resolveSmallIcon(context))
      .setPriority(Notification.PRIORITY_HIGH)
      .setCategory(Notification.CATEGORY_ALARM)
      .setOngoing(true)
      .setAutoCancel(false)
      .setFullScreenIntent(ringPendingIntent, true)
      .setContentIntent(ringPendingIntent)
      .build()

    manager.notify(record.id.hashCode(), notification)
  }

  private fun ensureChannel(manager: NotificationManager) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(CHANNEL_ID, "Alarms", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "zerospike full-screen alarms"
      // Silent on purpose: AlarmSoundService owns the loop/vibration so the
      // sound is not doubled and keeps playing after the notification is
      // dismissed from the lock screen.
      setSound(null, null)
      enableVibration(false)
    }
    manager.createNotificationChannel(channel)
  }

  private fun resolveSmallIcon(context: Context): Int {
    val fromApp = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
      .takeIf { it != 0 }
      ?: context.resources.getIdentifier("notification_icon", "mipmap", context.packageName).takeIf { it != 0 }
    return fromApp ?: android.R.drawable.ic_lock_idle_alarm
  }

  companion object {
    const val CHANNEL_ID = "zerospike-alarmkit-alarms"

    fun cancelNotification(context: Context, id: String) {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.cancel(id.hashCode())
    }
  }
}
