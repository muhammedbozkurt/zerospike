package expo.modules.zerospikealarmkit

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import java.util.Calendar

/**
 * Thin wrapper around AlarmManager.setAlarmClock - the same call
 * expo-notifications' own ExpoSchedulingDelegate avoids on purpose (it uses
 * setExactAndAllowWhileIdle) because setAlarmClock is the one API that both
 * survives Doze without any extra permission beyond SCHEDULE_EXACT_ALARM and
 * shows the OS's own "next alarm" affordance, which a real alarm should.
 */
object AlarmScheduler {
  private const val EXTRA_ALARM_ID = "expo.modules.zerospikealarmkit.EXTRA_ALARM_ID"

  private fun alarmManager(context: Context): AlarmManager =
    context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

  private fun operationIntent(context: Context, id: String): PendingIntent {
    val intent = Intent(context, AlarmReceiver::class.java).apply {
      putExtra(EXTRA_ALARM_ID, id)
    }
    return PendingIntent.getBroadcast(
      context,
      id.hashCode(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  private fun showIntent(context: Context): PendingIntent? {
    val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: return null
    return PendingIntent.getActivity(
      context,
      0,
      launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  /** Next hour:minute occurrence from now, tomorrow if today's has passed. */
  fun nextDailyTrigger(hour: Int, minute: Int): Long {
    val now = Calendar.getInstance()
    val next = Calendar.getInstance().apply {
      set(Calendar.HOUR_OF_DAY, hour)
      set(Calendar.MINUTE, minute)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
    }
    if (!next.after(now)) {
      next.add(Calendar.DAY_OF_YEAR, 1)
    }
    return next.timeInMillis
  }

  fun schedule(context: Context, record: AlarmRecord): Boolean = try {
    val info = AlarmManager.AlarmClockInfo(record.triggerAtMillis, showIntent(context))
    alarmManager(context).setAlarmClock(info, operationIntent(context, record.id))
    true
  } catch (e: SecurityException) {
    false
  }

  fun cancel(context: Context, id: String) {
    alarmManager(context).cancel(operationIntent(context, id))
  }

  fun extractAlarmId(intent: Intent): String? = intent.getStringExtra(EXTRA_ALARM_ID)
}
