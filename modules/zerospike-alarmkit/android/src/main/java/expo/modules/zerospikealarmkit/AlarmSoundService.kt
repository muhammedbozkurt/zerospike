package expo.modules.zerospikealarmkit

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.IBinder
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.annotation.RequiresApi

/**
 * Foreground service that owns the actual alarm sound/vibration loop, kept
 * separate from the notification so it survives the full-screen notification
 * being swiped away and keeps running until AlarmRingActivity's Stop button
 * (or a fresh alarm replacing it) tears it down.
 *
 * Runs as a "shortService" foreground service type (no type-specific
 * permission needed, ~3 minute OS-enforced budget) rather than
 * mediaPlayback, since this never plays media - it drives an alarm
 * (USAGE_ALARM) tone and vibration. onTimeout() below is required: if the
 * OS-imposed timeout is not handled, the app gets an ANR even if other
 * foreground services are still valid.
 */
class AlarmSoundService : Service() {
  private var mediaPlayer: MediaPlayer? = null
  private var vibrator: Vibrator? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        FOREGROUND_NOTIFICATION_ID,
        buildForegroundNotification(),
        ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE
      )
    } else {
      startForeground(FOREGROUND_NOTIFICATION_ID, buildForegroundNotification())
    }
    startSound()
    startVibration()
    return START_NOT_STICKY
  }

  /** Android 16 (API 36): fgsType is passed but the service only ever
   *  declares one type, so it is not needed to decide what to stop. */
  @RequiresApi(36)
  override fun onTimeout(startId: Int, fgsType: Int) {
    stopSoundAndVibration()
    stopSelf()
  }

  /** Android 15 (API 35) only, superseded by the two-arg overload above
   *  on API 36+. */
  @RequiresApi(Build.VERSION_CODES.VANILLA_ICE_CREAM)
  override fun onTimeout(startId: Int) {
    stopSoundAndVibration()
    stopSelf()
  }

  override fun onDestroy() {
    stopSoundAndVibration()
    super.onDestroy()
  }

  private fun stopSoundAndVibration() {
    mediaPlayer?.let {
      if (it.isPlaying) it.stop()
      it.release()
    }
    mediaPlayer = null
    vibrator?.cancel()
    vibrator = null
  }

  private fun startSound() {
    val soundUri = resolveSoundUri()
    mediaPlayer = MediaPlayer().apply {
      setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ALARM)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
      )
      setDataSource(this@AlarmSoundService, soundUri)
      isLooping = true
      prepare()
      start()
    }
  }

  private fun resolveSoundUri() = run {
    val resId = resources.getIdentifier("reminder", "raw", packageName)
    if (resId != 0) {
      android.net.Uri.parse("android.resource://$packageName/$resId")
    } else {
      RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM)
        ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
    }
  }

  private fun startVibration() {
    vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
    }
    val pattern = longArrayOf(0, 800, 500)
    vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))
  }

  private fun buildForegroundNotification(): Notification =
    Notification.Builder(this, AlarmReceiver.CHANNEL_ID)
      .setContentTitle(applicationInfo.loadLabel(packageManager).toString())
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setCategory(Notification.CATEGORY_SERVICE)
      .setOngoing(true)
      .build()

  companion object {
    private const val FOREGROUND_NOTIFICATION_ID = 918273

    fun startIntent(context: Context, id: String): Intent =
      Intent(context, AlarmSoundService::class.java).putExtra("id", id)

    fun stopIntent(context: Context): Intent = Intent(context, AlarmSoundService::class.java)
  }
}
