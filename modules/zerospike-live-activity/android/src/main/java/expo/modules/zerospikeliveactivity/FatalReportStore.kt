package expo.modules.zerospikeliveactivity

import android.content.Context
import android.os.Build
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * Last fatal report (A3), Android side of the iOS NSSetUncaughtExceptionHandler
 * hook in ZerospikeLiveActivityModule.swift. A release-build fatal JS error
 * reaches this too: ExceptionsManagerModule throws a JavascriptException on the
 * native modules thread. The report stays in SharedPreferences on the device;
 * JS reads it on the next launch. Same JSON shape on both platforms.
 *
 * Backup: the app runs with android:allowBackup="true" (Expo default), so this
 * SharedPreferences file can ride along in an Auto Backup. Accepted for now: the
 * report holds an error message and stack, no health record.
 */
internal object FatalReportStore {
  private const val PREFS = "zerospike.fatal"
  private const val KEY = "lastFatalReport"
  private const val JS_MESSAGE_LIMIT = 2000

  @Volatile
  private var installed = false

  // Read once at install so the crash path does no PackageManager call.
  @Volatile
  private var appVersionName = ""

  @Volatile
  private var appBuild = ""

  @Synchronized
  fun install(context: Context) {
    if (installed) return
    installed = true
    val app = context.applicationContext
    logPrevious(app)
    val (version, build) = appVersion(app)
    appVersionName = version
    appBuild = build
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

  /** The report the previous run left, as one logcat line: a build that dies
   *  right after every launch never gets to run the JS reader, this runs first. */
  private fun logPrevious(context: Context) {
    try {
      val raw = read(context) ?: return
      val o = JSONObject(raw)
      val js = clipped(o.optString("jsMessage", ""), 1500)
      val line = "zerospike last fatal: ${o.optString("name", "")} | " +
        "${o.optString("reason", "")} | $js | build ${o.optString("build", "")}"
      Log.e("zerospike", line.replace('\n', ' ').replace('\r', ' '))
    } catch (e: Throwable) {
      // Logging is best-effort; start-up must go on.
    }
  }

  private fun clipped(text: String, limit: Int): String =
    if (text.length > limit) text.substring(0, limit) else text

  private fun record(context: Context, thread: Thread, error: Throwable) {
    val stack = JSONArray()
    error.stackTrace.take(40).forEach { stack.put(clipped(it.toString(), 300)) }
    val report = JSONObject()
    report.put("platform", "android")
    report.put("kind", error.javaClass.name)
    report.put("name", clipped(error.javaClass.name, 500))
    report.put("reason", clipped(error.message ?: "", 4000))
    report.put("thread", clipped(thread.name, 200))
    report.put("stack", stack)
    report.put("build", appBuild)
    report.put("version", appVersionName)
    // Epoch ms; lib/fatalReport.ts turns it into ISO.
    report.put("at", System.currentTimeMillis())
    // A fatal JS error: the message already carries the JS message and stack.
    if (error.javaClass.name.endsWith("JavascriptException")) {
      report.put("jsMessage", clipped(error.message ?: "", JS_MESSAGE_LIMIT))
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
}
