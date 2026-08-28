package com.greeneyeapp.zerospike.wear

import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.WearableListenerService

private const val LIVE_DATA_PATH = "/zerospike/livedata"
private const val LIVE_DATA_FIELD = "json"

/**
 * Receives the phone's DataClient.putDataItem pushes at /zerospike/livedata.
 * The DataMap carries exactly one string field, "json" - the whole LiveData
 * snapshot from lib/services/liveData.ts. Semantics are "last write wins", so
 * every TYPE_CHANGED event fully replaces the cached snapshot; there is
 * nothing to merge and nothing to reconcile.
 */
class WearDataListenerService : WearableListenerService() {

    override fun onDataChanged(dataEvents: DataEventBuffer) {
        try {
            dataEvents.forEach { event ->
                if (event.type != DataEvent.TYPE_CHANGED) return@forEach
                val item = event.dataItem
                if (item.uri.path != LIVE_DATA_PATH) return@forEach

                val json = DataMapItem.fromDataItem(item).dataMap.getString(LIVE_DATA_FIELD)
                    ?: return@forEach
                LiveDataStore.update(applicationContext, json)
            }
        } finally {
            dataEvents.release()
        }
    }
}
