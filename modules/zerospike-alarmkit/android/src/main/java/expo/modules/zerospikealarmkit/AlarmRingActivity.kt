package expo.modules.zerospikealarmkit

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The lock-screen alarm surface a full-screen-intent notification launches.
 * Plain framework Views on purpose: this module adds no Compose/AppCompat
 * dependency of its own, so the UI is built in code rather than from an XML
 * layout resource.
 */
class AlarmRingActivity : Activity() {
  private var alarmId: String? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    showOverLockScreen()

    alarmId = intent.getStringExtra(EXTRA_ID)
    val label = intent.getStringExtra(EXTRA_LABEL).orEmpty()
    val stopLabel = intent.getStringExtra(EXTRA_STOP_LABEL).orEmpty()
    val openLabel = intent.getStringExtra(EXTRA_OPEN_LABEL).orEmpty()
    val route = intent.getStringExtra(EXTRA_ROUTE).orEmpty()

    setContentView(buildContentView(label, stopLabel, openLabel, route))
  }

  private fun showOverLockScreen() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
      (getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager)
        ?.requestDismissKeyguard(this, null)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
          WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
      )
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
  }

  private fun buildContentView(label: String, stopLabel: String, openLabel: String, route: String) =
    LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setPadding(64, 64, 64, 64)

      addView(
        TextView(this@AlarmRingActivity).apply {
          text = label
          textSize = 24f
          gravity = Gravity.CENTER
        }
      )

      addView(
        Button(this@AlarmRingActivity).apply {
          text = openLabel
          setOnClickListener { onOpenPressed(route) }
        }
      )

      addView(
        Button(this@AlarmRingActivity).apply {
          text = stopLabel
          setOnClickListener { onStopPressed() }
        }
      )
    }

  private fun onStopPressed() {
    dismiss()
    finish()
  }

  private fun onOpenPressed(route: String) {
    dismiss()
    if (route.isNotEmpty()) {
      // The id this activity was launched with, so the app opens the reminder
      // that actually rang instead of inferring it back from the clock.
      AlarmStore.setPending(this, route, alarmId)
    }
    packageManager.getLaunchIntentForPackage(packageName)?.let {
      it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      startActivity(it)
    }
    finish()
  }

  private fun dismiss() {
    stopService(AlarmSoundService.stopIntent(this))
    alarmId?.let { AlarmReceiver.cancelNotification(this, it) }
  }

  companion object {
    private const val EXTRA_ID = "expo.modules.zerospikealarmkit.EXTRA_ID"
    private const val EXTRA_LABEL = "expo.modules.zerospikealarmkit.EXTRA_LABEL"
    private const val EXTRA_STOP_LABEL = "expo.modules.zerospikealarmkit.EXTRA_STOP_LABEL"
    private const val EXTRA_OPEN_LABEL = "expo.modules.zerospikealarmkit.EXTRA_OPEN_LABEL"
    private const val EXTRA_ROUTE = "expo.modules.zerospikealarmkit.EXTRA_ROUTE"

    fun launchIntent(context: Context, record: AlarmRecord): Intent =
      Intent(context, AlarmRingActivity::class.java).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        putExtra(EXTRA_ID, record.id)
        putExtra(EXTRA_LABEL, record.label)
        putExtra(EXTRA_STOP_LABEL, record.stopLabel)
        putExtra(EXTRA_OPEN_LABEL, record.openLabel)
        putExtra(EXTRA_ROUTE, record.route)
      }
  }
}
