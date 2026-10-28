package com.greeneyeapp.zerospike.wear

import android.text.format.DateFormat
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.SuspendingComplicationDataSourceService
import java.util.Date

/**
 * Single SHORT_TEXT complication: the last logged reading with its unit as the
 * title, from the same LiveDataStore cache the tile and MainActivity read. No
 * medical framing - a bare number/unit pair, never an alert or a threshold
 * judgement.
 *
 * Deliberately uncoloured: SHORT_TEXT complication data carries no colour of
 * its own (ShortTextComplicationData.Builder exposes text, title, images and a
 * tap action only) - the watch face owns the palette of its own slots. So the
 * status colour the screen and the tile paint cannot be carried here, and the
 * value plus its unit are the whole signal, which is what the app's rule asks
 * for anyway.
 */
class ZerospikeComplicationService : SuspendingComplicationDataSourceService() {

    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData? {
        if (request.complicationType != ComplicationType.SHORT_TEXT) return null

        val data = LiveDataStore.load(applicationContext)
        val hasReading = data != null && data.readingMgdl() != null
        // SHORT_TEXT is a handful of characters wide on most watch faces, so the
        // empty state is the same dash the app screen shows, not a sentence that
        // every face would truncate. The full wording stays in the description.
        val reading = data?.readingDisplay()?.takeIf { it.isNotBlank() } ?: "--"

        val builder = ShortTextComplicationData.Builder(
            text = PlainComplicationText.Builder(reading).build(),
            contentDescription = PlainComplicationText.Builder(
                if (hasReading) {
                    getString(R.string.last_reading_label)
                } else {
                    getString(R.string.no_data)
                }
            ).build()
        )
        if (hasReading) {
            // A sensor value can be old with nothing on a watch face to say so, so
            // its title is the clock time it was read at; a hand-logged one keeps
            // the unit.
            val sensor = data?.activeCgm
            val title = if (sensor != null) {
                DateFormat.getTimeFormat(applicationContext).format(Date(sensor.at))
            } else {
                unitLabelOf(data?.unit)
            }
            builder.setTitle(PlainComplicationText.Builder(title).build())
        }
        return builder.build()
    }

    override fun getPreviewData(type: ComplicationType): ComplicationData? {
        if (type != ComplicationType.SHORT_TEXT) return null

        return ShortTextComplicationData.Builder(
            text = PlainComplicationText.Builder("120").build(),
            contentDescription = PlainComplicationText.Builder(
                getString(R.string.last_reading_label)
            ).build()
        )
            .setTitle(PlainComplicationText.Builder(unitLabelOf(null)).build())
            .build()
    }
}
