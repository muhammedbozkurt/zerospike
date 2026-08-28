package com.greeneyeapp.zerospike.wear

import android.text.format.DateFormat
import androidx.compose.ui.graphics.toArgb
import androidx.concurrent.futures.CallbackToFutureAdapter
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DimensionBuilders.dp
import androidx.wear.protolayout.DimensionBuilders.expand
import androidx.wear.protolayout.DimensionBuilders.sp
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.ListenableFuture
import java.util.Date

private const val RESOURCES_VERSION = "1"

/** Long enough not to cost battery, short enough that the reminder time on the
 *  tile cannot sit there for an hour after it has passed. A relayed snapshot
 *  still refreshes it immediately (LiveDataStore.update calls the updater). */
private const val FRESHNESS_MS = 10L * 60L * 1000L

/**
 * One tile carrying the same three facts, and the same design language, as the
 * app screen: the last logged reading in its own status colour, its unit, and
 * either the running post-meal window or the next pending reminder. Colours are
 * the tokens in WearDesign.kt, which are the tokens in lib/theme/tokens.ts - the
 * tile owns none of its own.
 *
 * No medical framing: a value and a time, exactly what the phone widget and the
 * complication also show.
 */
class ZerospikeTileService : TileService() {

    override fun onTileRequest(
        requestParams: RequestBuilders.TileRequest
    ): ListenableFuture<TileBuilders.Tile> =
        CallbackToFutureAdapter.getFuture { completer ->
            val tile = TileBuilders.Tile.Builder()
                .setResourcesVersion(RESOURCES_VERSION)
                .setFreshnessIntervalMillis(FRESHNESS_MS)
                .setTileTimeline(TimelineBuilders.Timeline.fromLayoutElement(glanceLayout()))
                .build()

            completer.set(tile)
            "ZerospikeTileService.onTileRequest"
        }

    override fun onTileResourcesRequest(
        requestParams: RequestBuilders.ResourcesRequest
    ): ListenableFuture<ResourceBuilders.Resources> =
        CallbackToFutureAdapter.getFuture { completer ->
            completer.set(
                ResourceBuilders.Resources.Builder()
                    .setVersion(RESOURCES_VERSION)
                    .build()
            )
            "ZerospikeTileService.onTileResourcesRequest"
        }

    private fun glanceLayout(): LayoutElementBuilders.LayoutElement {
        val data = LiveDataStore.load(applicationContext)
        val mgdl = data?.lastGlucoseMgdl
        val statusColor = (mgdl?.let { glucoseColorFor(it, data?.band) } ?: Ink.Muted).toArgb()
        val reading = data?.lastGlucoseDisplay?.takeIf { it.isNotBlank() } ?: "--"

        val column = LayoutElementBuilders.Column.Builder()
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            .addContent(
                styledText(
                    text = data?.labels?.lastReading?.takeIf { it.isNotBlank() }
                        ?: getString(R.string.last_reading_label),
                    sizeSp = 13f,
                    weight = LayoutElementBuilders.FONT_WEIGHT_MEDIUM,
                    color = Ink.Muted.toArgb()
                )
            )
            .addContent(
                styledText(
                    text = reading,
                    sizeSp = 40f,
                    weight = LayoutElementBuilders.FONT_WEIGHT_BOLD,
                    color = statusColor
                )
            )

        // Colour is never the only signal: the unit sits under the number
        // whenever there is a number, and the label above it always does.
        if (mgdl != null) {
            column.addContent(
                styledText(
                    text = unitLabelOf(data?.unit),
                    sizeSp = 13f,
                    weight = LayoutElementBuilders.FONT_WEIGHT_NORMAL,
                    color = Ink.Muted.toArgb()
                )
            )
        } else {
            column.addContent(
                styledText(
                    text = data?.labels?.noData?.takeIf { it.isNotBlank() }
                        ?: getString(R.string.no_data),
                    sizeSp = 13f,
                    weight = LayoutElementBuilders.FONT_WEIGHT_NORMAL,
                    color = Ink.Muted.toArgb()
                )
            )
        }

        val now = System.currentTimeMillis()
        val postMealEndsAt = data?.postMealEndsAt
        val reminderAt = data?.nextReminderAt
        val upcoming: Pair<String, String>? = when {
            postMealEndsAt != null && postMealEndsAt > now ->
                (data?.labels?.timerTitle?.takeIf { it.isNotBlank() }
                    ?: getString(R.string.post_meal_label)) to clockTime(postMealEndsAt)

            reminderAt != null && reminderAt > now ->
                (data?.labels?.nextReminder?.takeIf { it.isNotBlank() }
                    ?: getString(R.string.next_reminder_label)) to clockTime(reminderAt)

            else -> null
        }

        if (upcoming != null) {
            column
                .addContent(
                    LayoutElementBuilders.Spacer.Builder().setHeight(dp(10f)).build()
                )
                .addContent(
                    styledText(
                        text = upcoming.first,
                        sizeSp = 12f,
                        weight = LayoutElementBuilders.FONT_WEIGHT_MEDIUM,
                        color = Ink.Muted.toArgb()
                    )
                )
                .addContent(
                    styledText(
                        text = upcoming.second,
                        sizeSp = 18f,
                        weight = LayoutElementBuilders.FONT_WEIGHT_MEDIUM,
                        color = Ink.Accent.toArgb()
                    )
                )
        }

        return LayoutElementBuilders.Box.Builder()
            .setWidth(expand())
            .setHeight(expand())
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
            .setModifiers(
                ModifiersBuilders.Modifiers.Builder()
                    .setBackground(
                        ModifiersBuilders.Background.Builder()
                            .setColor(argb(Ink.Ground.toArgb()))
                            .build()
                    )
                    // A tile is drawn to the bezel, so the text is kept inside
                    // the round screen's inscribed area by hand.
                    .setPadding(
                        ModifiersBuilders.Padding.Builder().setAll(dp(22f)).build()
                    )
                    .build()
            )
            .addContent(column.build())
            .build()
    }

    private fun styledText(
        text: String,
        sizeSp: Float,
        weight: Int,
        color: Int
    ): LayoutElementBuilders.Text =
        LayoutElementBuilders.Text.Builder()
            .setText(text)
            .setMaxLines(2)
            .setMultilineAlignment(LayoutElementBuilders.TEXT_ALIGN_CENTER)
            .setOverflow(LayoutElementBuilders.TEXT_OVERFLOW_ELLIPSIZE_END)
            .setFontStyle(
                LayoutElementBuilders.FontStyle.Builder()
                    .setSize(sp(sizeSp))
                    .setWeight(weight)
                    .setColor(argb(color))
                    .build()
            )
            .build()

    /** The watch's own 12/24-hour setting, same as the app screen uses. */
    private fun clockTime(epochMs: Long): String =
        DateFormat.getTimeFormat(this).format(Date(epochMs))
}
