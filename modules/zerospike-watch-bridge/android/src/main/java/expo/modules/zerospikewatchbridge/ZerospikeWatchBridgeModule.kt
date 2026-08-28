package expo.modules.zerospikewatchbridge

import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Relays the phone's LiveData snapshot to the paired Wear OS companion via the
// Data Layer API. Mirrors the iOS side (WatchConnectivity applicationContext):
// DataClient.putDataItem keeps only the most recent item at a given path, the
// same "latest snapshot wins" semantics, so JS (lib/services/liveData.ts) does
// not need to know which platform it is running on.
//
// isAvailable()/pushLiveData() are synchronous in JS, but the Play Services
// Wearable APIs (NodeClient, CapabilityClient) are Task-based and asynchronous.
// This module therefore caches the last known availability and refreshes it in
// the background; the very first call after process start can under-report
// (returns the cached `false` default) but every push already re-checks
// availability, and liveData.ts re-pushes on every snapshot, so the watch is
// picked up on the next call once the refresh lands.
class ZerospikeWatchBridgeModule : Module() {
  companion object {
    private const val DATA_PATH = "/zerospike/livedata"
    private const val DATA_KEY = "json"
    private const val CAPABILITY_NAME = "zerospike_wear_app"
  }

  @Volatile
  private var cachedAvailability = false

  override fun definition() = ModuleDefinition {
    Name("ZerospikeWatchBridge")

    OnCreate {
      refreshAvailability()
    }

    /** True only when a connected node advertises the watch companion capability. */
    Function("isAvailable") {
      refreshAvailability()
      cachedAvailability
    }

    /** Pushes the latest LiveData JSON. Best-effort, never throws. */
    Function("pushLiveData") { json: String ->
      pushLiveDataInternal(json)
    }
  }

  private fun refreshAvailability() {
    val context = appContext.reactContext ?: return
    try {
      Wearable.getNodeClient(context).connectedNodes
        .addOnSuccessListener { nodes ->
          if (nodes.isEmpty()) {
            cachedAvailability = false
            return@addOnSuccessListener
          }
          try {
            Wearable.getCapabilityClient(context)
              .getCapability(CAPABILITY_NAME, CapabilityClient.FILTER_REACHABLE)
              .addOnSuccessListener { info ->
                cachedAvailability = info.nodes.isNotEmpty()
              }
              .addOnFailureListener {
                cachedAvailability = false
              }
          } catch (e: Exception) {
            cachedAvailability = false
          }
        }
        .addOnFailureListener {
          cachedAvailability = false
        }
    } catch (e: Exception) {
      // No Google Play services (or any other unexpected failure): treat the
      // watch as unreachable instead of crashing the caller.
      cachedAvailability = false
    }
  }

  private fun pushLiveDataInternal(json: String): Boolean {
    val context = appContext.reactContext ?: return false
    return try {
      val request = PutDataMapRequest.create(DATA_PATH).apply {
        dataMap.putString(DATA_KEY, json)
      }.asPutDataRequest()
      Wearable.getDataClient(context).putDataItem(request)
      true
    } catch (e: Exception) {
      false
    }
  }
}
