package expo.modules.zerospikealarmkit

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

/**
 * One entry per scheduled alarm, keyed by the caller-owned id string from
 * lib/services/notifications.ts. Persisted (not just kept in memory) so
 * BootReceiver can re-arm everything after a reboot and AlarmReceiver can
 * re-arm a daily alarm for its next occurrence.
 */
data class AlarmRecord(
  val id: String,
  val isDaily: Boolean,
  val hour: Int,
  val minute: Int,
  val triggerAtMillis: Long,
  val label: String,
  val stopLabel: String,
  val openLabel: String,
  val route: String
) {
  fun toJson(): String = JSONObject().apply {
    put(KEY_ID, id)
    put(KEY_IS_DAILY, isDaily)
    put(KEY_HOUR, hour)
    put(KEY_MINUTE, minute)
    put(KEY_TRIGGER_AT, triggerAtMillis)
    put(KEY_LABEL, label)
    put(KEY_STOP_LABEL, stopLabel)
    put(KEY_OPEN_LABEL, openLabel)
    put(KEY_ROUTE, route)
  }.toString()

  companion object {
    private const val KEY_ID = "id"
    private const val KEY_IS_DAILY = "isDaily"
    private const val KEY_HOUR = "hour"
    private const val KEY_MINUTE = "minute"
    private const val KEY_TRIGGER_AT = "triggerAtMillis"
    private const val KEY_LABEL = "label"
    private const val KEY_STOP_LABEL = "stopLabel"
    private const val KEY_OPEN_LABEL = "openLabel"
    private const val KEY_ROUTE = "route"

    fun fromJson(raw: String): AlarmRecord? = try {
      val json = JSONObject(raw)
      AlarmRecord(
        id = json.getString(KEY_ID),
        isDaily = json.getBoolean(KEY_IS_DAILY),
        hour = json.optInt(KEY_HOUR, 0),
        minute = json.optInt(KEY_MINUTE, 0),
        triggerAtMillis = json.optLong(KEY_TRIGGER_AT, 0L),
        label = json.getString(KEY_LABEL),
        stopLabel = json.getString(KEY_STOP_LABEL),
        openLabel = json.getString(KEY_OPEN_LABEL),
        route = json.getString(KEY_ROUTE)
      )
    } catch (e: Exception) {
      null
    }
  }
}

/**
 * What an alarm's "Open" button left behind: the screen to land on and, when
 * the ringing alarm knew it, the id it was scheduled under. `alarmId` is null
 * for an alarm armed by a build that predated it, which is exactly the case
 * app/_layout.tsx falls back to time matching for.
 */
data class PendingAlarm(val route: String, val alarmId: String?)

/**
 * SharedPreferences-backed store for AlarmRecords plus the single read-once
 * "pending route" slot (mirrors takePendingAlarmRoute's contract in index.ts).
 * One flat file, one entry per id under an "alarm_" prefix - listing is a
 * prefix scan over prefs.all rather than a separate index that could drift
 * out of sync with the entries themselves.
 */
object AlarmStore {
  private const val PREFS_NAME = "zerospike_alarmkit_store"
  private const val ALARM_KEY_PREFIX = "alarm_"
  private const val PENDING_ROUTE_KEY = "pending_route"
  private const val PENDING_ALARM_ID_KEY = "pending_alarm_id"
  private const val HAS_REQUESTED_AUTH_KEY = "has_requested_authorization"

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  fun save(context: Context, record: AlarmRecord) {
    prefs(context).edit().putString(ALARM_KEY_PREFIX + record.id, record.toJson()).apply()
  }

  fun get(context: Context, id: String): AlarmRecord? =
    prefs(context).getString(ALARM_KEY_PREFIX + id, null)?.let(AlarmRecord::fromJson)

  fun remove(context: Context, id: String) {
    prefs(context).edit().remove(ALARM_KEY_PREFIX + id).apply()
  }

  fun all(context: Context): List<AlarmRecord> =
    prefs(context).all
      .filterKeys { it.startsWith(ALARM_KEY_PREFIX) }
      .values
      .mapNotNull { (it as? String)?.let(AlarmRecord::fromJson) }

  fun allIds(context: Context): List<String> = all(context).map { it.id }

  /** Parks both halves of a tapped alarm: WHICH screen to open and WHICH alarm
   *  asked for it (the caller-owned "zerospike-alarm-<reminderId>" string).
   *  Written in one edit, and an alarm with no id explicitly clears the key
   *  rather than leaving the previous alarm's id to be paired with this route. */
  fun setPending(context: Context, route: String, alarmId: String?) {
    prefs(context).edit().apply {
      if (alarmId.isNullOrEmpty()) remove(PENDING_ALARM_ID_KEY)
      else putString(PENDING_ALARM_ID_KEY, alarmId)
      putString(PENDING_ROUTE_KEY, route)
    }.apply()
  }

  /** Reads and clears both pending keys in one shot - same read-once contract
   *  as takePendingAlarmRoute in index.ts. A stray id with no route beside it
   *  is dropped, so it can never attach itself to a later alarm's route. */
  fun takePending(context: Context): PendingAlarm? {
    val p = prefs(context)
    val route = p.getString(PENDING_ROUTE_KEY, null)
    if (route.isNullOrEmpty()) {
      if (p.contains(PENDING_ALARM_ID_KEY)) p.edit().remove(PENDING_ALARM_ID_KEY).apply()
      return null
    }
    val alarmId = p.getString(PENDING_ALARM_ID_KEY, null)
    p.edit().remove(PENDING_ROUTE_KEY).remove(PENDING_ALARM_ID_KEY).apply()
    return PendingAlarm(route, alarmId?.takeIf { it.isNotEmpty() })
  }

  fun hasRequestedAuthorization(context: Context): Boolean =
    prefs(context).getBoolean(HAS_REQUESTED_AUTH_KEY, false)

  fun markRequestedAuthorization(context: Context) {
    prefs(context).edit().putBoolean(HAS_REQUESTED_AUTH_KEY, true).apply()
  }
}
