package expo.modules.zerospikealarmkit

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.IBinder
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * Foreground service that owns the actual alarm sound/vibration loop, kept
 * separate from the notification so it survives the full-screen notification
 * being swiped away and keeps running until AlarmRingActivity's Stop button
 * (or a fresh alarm replacing it) tears it down.
 */
class AlarmSoundService : Service() {
  private var mediaPlayer: MediaPlayer? = null
  private var vibrator: Vibrator? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startForeground(FOREGROUND_NOTIFICATION_ID, buildForegroundNotification())
    startSound()
    startVibration()
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    mediaPlayer?.let {
      if (it.isPlaying) it.stop()
      it.release()
    }
    mediaPlayer = null
    vibrator?.cancel()
    vibrator = null
    super.onDestroy()
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
