package com.greeneyeapp.zerospike.wear

import android.content.ComponentName
import android.content.Context
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.wear.tiles.TileService
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import org.json.JSONObject

/**
 * Same wire contract as lib/services/liveData.ts's `LiveData` interface. The
 * phone writes ONE DataMap field named "json" to /zerospike/livedata holding
 * this whole snapshot as a JSON string; "last write wins" is the only
 * semantics - there is no merge, no history, just the newest blob.
 *
 * Field names below are taken verbatim from that TypeScript interface, not
 * guessed. `labels` carries the app's own already-localized strings, kept
 * here for a future richer tile/complication even though this skeleton's
 * MainActivity only reads a handful of the top-level fields.
 */
data class LiveDataSnapshot(
    val updatedAt: Long,
    val unit: String,
    val lang: String,
    val lastGlucoseMgdl: Double?,
    val lastGlucoseDisplay: String?,
    val lastGlucoseAt: Long?,
    val avgGlucoseMgdl: Double?,
    val avgGlucoseDisplay: String?,
    val avgWindowDays: Int,
    val nextReminderAt: Long?,
    val nextReminderKind: String?,
    val nextReminderLabel: String?,
    val nextReminderMode: String?,
    val postMealEndsAt: Long?,
    val usesInsulin: Boolean,
    val usesOralMeds: Boolean,
    val band: Band?,
    val labels: Labels?
) {
    data class Band(
        val hypo: Double,
        val low: Double,
        val high: Double,
        val veryHigh: Double
    )

    data class Labels(
        val lastReading: String,
        val avgGlucose: String,
        val avgWindow: String,
        val nextReminder: String,
        val noData: String,
        val hourShort: String,
        val minuteShort: String,
        val agoTemplate: String,
        val quickAdd: String,
        val addGlucose: String,
        val addMeal: String,
        val addInjection: String,
        val addMed: String,
        val timerTitle: String,
        val startCountdown: String?
    )

    companion object {
        /** Returns null on any parse failure - a malformed snapshot must never crash the watch. */
        fun fromJson(json: String): LiveDataSnapshot? = try {
            val obj = JSONObject(json)
            LiveDataSnapshot(
                updatedAt = obj.optLong("updatedAt"),
                unit = obj.optString("unit", "mgdl"),
                lang = obj.optString("lang", "en"),
                lastGlucoseMgdl = obj.nullableDouble("lastGlucoseMgdl"),
                lastGlucoseDisplay = obj.nullableString("lastGlucoseDisplay"),
                lastGlucoseAt = obj.nullableLong("lastGlucoseAt"),
                avgGlucoseMgdl = obj.nullableDouble("avgGlucoseMgdl"),
                avgGlucoseDisplay = obj.nullableString("avgGlucoseDisplay"),
                avgWindowDays = obj.optInt("avgWindowDays", 7),
                nextReminderAt = obj.nullableLong("nextReminderAt"),
                nextReminderKind = obj.nullableString("nextReminderKind"),
                nextReminderLabel = obj.nullableString("nextReminderLabel"),
                nextReminderMode = obj.nullableString("nextReminderMode"),
                postMealEndsAt = obj.nullableLong("postMealEndsAt"),
                usesInsulin = obj.optBoolean("usesInsulin", false),
                usesOralMeds = obj.optBoolean("usesOralMeds", false),
                band = obj.optJSONObject("band")?.let {
                    Band(
                        hypo = it.optDouble("hypo"),
                        low = it.optDouble("low"),
                        high = it.optDouble("high"),
                        veryHigh = it.optDouble("veryHigh")
                    )
                },
                labels = obj.optJSONObject("labels")?.let { l ->
                    Labels(
                        lastReading = l.optString("lastReading"),
                        avgGlucose = l.optString("avgGlucose"),
                        avgWindow = l.optString("avgWindow"),
                        nextReminder = l.optString("nextReminder"),
                        noData = l.optString("noData"),
                        hourShort = l.optString("hourShort"),
                        minuteShort = l.optString("minuteShort"),
                        agoTemplate = l.optString("agoTemplate"),
                        quickAdd = l.optString("quickAdd"),
                        addGlucose = l.optString("addGlucose"),
                        addMeal = l.optString("addMeal"),
                        addInjection = l.optString("addInjection"),
                        addMed = l.optString("addMed"),
                        timerTitle = l.optString("timerTitle"),
                        startCountdown = l.nullableString("startCountdown")
                    )
                }
            )
        } catch (e: Exception) {
            null
        }

        private fun JSONObject.nullableString(key: String): String? =
            if (has(key) && !isNull(key)) optString(key) else null

        private fun JSONObject.nullableLong(key: String): Long? =
            if (has(key) && !isNull(key)) optLong(key) else null

        private fun JSONObject.nullableDouble(key: String): Double? =
            if (has(key) && !isNull(key)) optDouble(key) else null
    }
}

/**
 * Local cache of the last snapshot relayed by the phone, plus the fan-out that
 * keeps the tile and complication in sync with it. WearDataListenerService is
 * the only writer; MainActivity, the tile and the complication are readers.
 */
object LiveDataStore {
    private const val PREFS_NAME = "zerospike_live_data"
    private const val KEY_JSON = "json"

    /** Compose-observable so MainActivity redraws the moment a new snapshot lands. */
    val snapshot: MutableState<LiveDataSnapshot?> = mutableStateOf(null)

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /** Loads the last cached snapshot from disk (cold start / process death). */
    fun load(context: Context): LiveDataSnapshot? {
        snapshot.value?.let { return it }
        val cached = prefs(context).getString(KEY_JSON, null) ?: return null
        val parsed = LiveDataSnapshot.fromJson(cached)
        snapshot.value = parsed
        return parsed
    }

    /**
     * Persists a freshly received snapshot and invalidates the tile and
     * complication so both redraw with it. Called only from
     * WearDataListenerService.onDataChanged.
     */
    fun update(context: Context, json: String) {
        prefs(context).edit().putString(KEY_JSON, json).apply()
        snapshot.value = LiveDataSnapshot.fromJson(json)

        TileService.getUpdater(context).requestUpdate(ZerospikeTileService::class.java)
        ComplicationDataSourceUpdateRequester.create(
            context,
            ComponentName(context, ZerospikeComplicationService::class.java)
        ).requestUpdateAll()
    }
}
