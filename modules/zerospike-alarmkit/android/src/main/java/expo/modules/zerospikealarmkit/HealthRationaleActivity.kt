package expo.modules.zerospikealarmkit

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle

/**
 * Entry point for Health Connect's permission rationale intents (see
 * plugins/withHealthRationaleRouting.js). JS cannot read an intent's action,
 * so this invisible activity turns the intent into a deep link that
 * expo-router already resolves to app/settings/health-rationale.tsx.
 */
class HealthRationaleActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val route = Intent(Intent.ACTION_VIEW, Uri.parse(ROUTE)).apply {
      setPackage(packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
    try {
      startActivity(route)
    } catch (e: ActivityNotFoundException) {
      packageManager.getLaunchIntentForPackage(packageName)?.let { startActivity(it) }
    }
    finish()
  }

  private companion object {
    const val ROUTE = "zerospike://settings/health-rationale"
  }
}
