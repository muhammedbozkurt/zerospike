package expo.modules.zerospikeliveactivity

import android.content.Context
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Last fatal report (A3), Android side of the iOS NSSetUncaughtExceptionHandler
 * hook in ZerospikeLiveActivityModule.swift. A release-build fatal JS error
 * reaches this too: ExceptionsManagerModule throws a JavascriptException on the
 * native modules thread. The report stays in SharedPreferences on the device;
 * JS reads it on the next launch. Same JSON shape on both platforms.
 */
internal object FatalReportStore {
  private const val PREFS = "zerospike.fatal"
  private const val KEY = "lastFatalReport"

  @Volatile
  private var installed = false

  @Synchronized
  fun install(context: Context) {
    if (installed) return
    installed = true
    val app = context.applicationContext
    // Chained, not replaced: the platform handler still runs, so the process
    // dies and the system crash report is exactly what it was before.
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, error ->
      try {
        record(app, thread, error)
      } catch (e: Throwable) {
        // A failing report must never mask the original crash.
      }
      if (previous != null) {
        previous.uncaughtException(thread, error)
      } else {
        android.os.Process.killProcess(android.os.Process.myPid())
        kotlin.system.exitProcess(10)
      }
    }
  }

  fun read(context: Context): String? = try {
    context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(KEY, null)
  } catch (e: Throwable) {
    null
  }

  fun clear(context: Context): Boolean = try {
    context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .remove(KEY)
      .commit()
  } catch (e: Throwable) {
    false
  }

  private fun clipped(text: String, limit: Int): String =
    if (text.length > limit) text.substring(0, limit) else text

  private fun record(context: Context, thread: Thread, error: Throwable) {
    val (version, build) = appVersion(context)
    val stack = JSONArray()
    error.stackTrace.take(40).forEach { stack.put(clipped(it.toString(), 300)) }
    val report = JSONObject()
    report.put("platform", "android")
    report.put("kind", error.javaClass.name)
    report.put("name", clipped(error.javaClass.name, 500))
    report.put("reason", clipped(error.message ?: "", 4000))
    report.put("thread", clipped(thread.name, 200))
    report.put("stack", stack)
    report.put("build", build)
    report.put("version", version)
    report.put("at", isoNow())
    // A fatal JS error: the message already carries the JS message and stack.
    if (error.javaClass.name.endsWith("JavascriptException")) {
      report.put("jsMessage", clipped(error.message ?: "", 8000))
    }
    error.cause?.let { report.put("cause", clipped(it.toString(), 1000)) }
    // commit(), not apply(): the process is about to die, the write must land now.
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY, report.toString())
      .commit()
  }

  private fun appVersion(context: Context): Pair<String, String> = try {
    val info = context.packageManager.getPackageInfo(context.packageName, 0)
    val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      info.longVersionCode.toString()
    } else {
      @Suppress("DEPRECATION")
      info.versionCode.toString()
    }
    Pair(info.versionName ?: "", code)
  } catch (e: Throwable) {
    Pair("", "")
  }

  private fun isoNow(): String {
    val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
    format.timeZone = TimeZone.getTimeZone("UTC")
    return format.format(Date())
  }
}
