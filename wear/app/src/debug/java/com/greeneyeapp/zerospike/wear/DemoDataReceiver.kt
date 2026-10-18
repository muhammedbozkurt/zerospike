package com.greeneyeapp.zerospike.wear

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject

/** Debug-only store screenshot feeder: adb shell am broadcast -a com.greeneyeapp.zerospike.wear.DEMO_DATA */
class DemoDataReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val now = System.currentTimeMillis()
        val mgdl = intent.getIntExtra("mgdl", 108)
        val json = JSONObject()
            .put("updatedAt", now)
            .put("unit", "mgdl")
            .put("lang", "en")
            .put("lastGlucoseMgdl", mgdl)
            .put("lastGlucoseDisplay", mgdl.toString())
            .put("lastGlucoseAt", now - 21 * 60_000L)
            .put("avgGlucoseMgdl", 112)
            .put("avgGlucoseDisplay", "112")
            .put("avgWindowDays", 7)
            .put("nextReminderAt", now + 95 * 60_000L)
            .put("nextReminderKind", "glucose")
            .put("usesInsulin", false)
            .put("usesOralMeds", false)
            .put(
                "band",
                JSONObject().put("hypo", 54).put("low", 70).put("high", 180).put("veryHigh", 250)
            )
        if (intent.getBooleanExtra("postmeal", false)) {
            val started = now - 25 * 60_000L
            json.put("postMealStartedAt", started).put("postMealEndsAt", started + 120 * 60_000L)
        }
        LiveDataStore.update(context.applicationContext, json.toString())
    }
}
