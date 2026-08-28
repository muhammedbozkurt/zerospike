package expo.modules.zerospikealarmkit

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * AlarmManager entries do not survive a reboot (or an app update, which
 * replaces the process the same way). Re-arms every AlarmRecord still in
 * AlarmStore so a reminder set as an alarm keeps ringing without the user
 * having to reopen the app first.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val now = System.currentTimeMillis()
    AlarmStore.all(context).forEach { record ->
      if (record.isDaily) {
        val rearmed = record.copy(triggerAtMillis = AlarmScheduler.nextDailyTrigger(record.hour, record.minute))
        AlarmStore.save(context, rearmed)
        AlarmScheduler.schedule(context, rearmed)
      } else if (record.triggerAtMillis > now) {
        AlarmScheduler.schedule(context, record)
      } else {
        AlarmStore.remove(context, record.id)
      }
    }
  }
}
