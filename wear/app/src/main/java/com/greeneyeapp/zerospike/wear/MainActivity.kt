package com.greeneyeapp.zerospike.wear

import android.content.Context
import android.os.Bundle
import android.text.format.DateFormat
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.AppScaffold
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.TimeText
import java.util.Date
import kotlinx.coroutines.delay

/**
 * The glance screen: the last logged reading in the app's one glucose colour
 * language, how long ago it was measured, and either the running post-meal
 * countdown or the next pending reminder. The same story, in the same order,
 * as the Apple Watch screen (targets/watch/ContentView.swift), so the two
 * companions read as one product.
 *
 * Descriptive only, exactly like every other glanceable surface: it reports
 * what was already logged on the phone. Reads LiveDataStore, never the phone.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        LiveDataStore.load(applicationContext)
        setContent { ZerospikeWearApp() }
    }
}

@Composable
private fun ZerospikeWearApp() {
    MaterialTheme(colorScheme = zerospikeColorScheme()) {
        // TimeText is the Wear counterpart of the system clock the Apple Watch
        // keeps in its top corner; AppScaffold + ScreenScaffold are what place
        // it on the arc instead of over the content.
        AppScaffold(timeText = { TimeText() }) {
            ScreenScaffold { GlanceScreen() }
        }
    }
}

@Composable
private fun GlanceScreen() {
    val context = LocalContext.current
    val data = LiveDataStore.snapshot.value

    // One second, because a running countdown ticks; the "ago" line and the
    // reminder time ride the same tick rather than owning a second timer.
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(1_000L)
            now = System.currentTimeMillis()
        }
    }

    val mgdl = data?.lastGlucoseMgdl
    val statusColor = mgdl?.let { glucoseColorFor(it, data?.band) } ?: Ink.Muted
    val reading = data?.lastGlucoseDisplay?.takeIf { it.isNotBlank() } ?: "--"
    val measuredAt = data?.lastGlucoseAt

    // A round screen clips its corners, so the content column is kept inside the
    // inscribed area rather than the bounding box. 11% a side leaves the longest
    // German label room to wrap instead of running under the bezel.
    val isRound = LocalConfiguration.current.isScreenRound
    val sidePadding = if (isRound) 26.dp else 14.dp

    Box(
        modifier = Modifier
            .fillMaxSize()
            .drawBehind {
                // THEME.bg: the vertical wash, a colour-matched glow behind the
                // reading (tokens' glow(), so the surface lights up in its own
                // status colour) and the cyan radial at the foot.
                drawRect(Brush.verticalGradient(listOf(Ink.TopWash, Ink.Ground)))
                drawRect(
                    Brush.radialGradient(
                        colors = listOf(statusColor.copy(alpha = 0.16f), Color.Transparent),
                        center = Offset(size.width / 2f, size.height * 0.40f),
                        radius = size.minDimension * 0.42f
                    )
                )
                drawRect(
                    Brush.radialGradient(
                        colors = listOf(Ink.GlowCyan, Color.Transparent),
                        center = Offset(size.width / 2f, size.height * 0.95f),
                        radius = size.minDimension * 0.46f
                    )
                )
            },
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = sidePadding),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            CaptionText(
                text = data?.labels?.lastReading?.takeIf { it.isNotBlank() }
                    ?: stringResource(id = R.string.last_reading_label),
                color = Ink.Muted
            )

            // The hero. Colour is never the only signal: the value itself and
            // the label above it are always on screen with it.
            Text(
                text = reading,
                color = statusColor,
                maxLines = 1,
                textAlign = TextAlign.Center,
                style = MaterialTheme.typography.numeralExtraLarge.copy(
                    // The placeholder is not the hero: at the reading's own size two
                    // dashes shout louder than the sentence that explains them.
                    fontSize = if (mgdl != null) 52.sp else 34.sp,
                    // Tight on purpose: digits carry no descender, and the default
                    // leading pushed the unit line away from the number it belongs to.
                    lineHeight = if (mgdl != null) 52.sp else 38.sp,
                    fontWeight = FontWeight.Bold
                )
            )

            if (mgdl != null) {
                Text(
                    text = unitLabelOf(data?.unit),
                    color = Ink.Muted,
                    maxLines = 1,
                    textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.bodySmall.copy(
                        fontSize = 13.sp,
                        lineHeight = 16.sp
                    )
                )
            }

            Text(
                text = when {
                    measuredAt == null ->
                        data?.labels?.noData?.takeIf { it.isNotBlank() }
                            ?: stringResource(id = R.string.no_data)
                    else ->
                        relativeAgo(now - measuredAt, data?.labels)
                            ?: clockTime(context, measuredAt)
                },
                color = Ink.Muted,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center,
                style = MaterialTheme.typography.bodySmall.copy(
                    fontSize = 14.sp,
                    lineHeight = 17.sp
                )
            )

            Spacer(modifier = Modifier.height(12.dp))
            Box(
                modifier = Modifier
                    .width(40.dp)
                    .height(1.dp)
                    .background(Ink.Border)
            )
            Spacer(modifier = Modifier.height(10.dp))

            UpcomingBlock(data = data, now = now, context = context)
        }
    }
}

/**
 * The bottom half: a running post-meal window outranks a pending reminder,
 * the same order the lock-screen card uses on the phone - a countdown already
 * ticking is what the wrist was raised for.
 */
@Composable
private fun UpcomingBlock(data: LiveDataSnapshot?, now: Long, context: Context) {
    val postMealEndsAt = data?.postMealEndsAt
    val reminderAt = data?.nextReminderAt

    when {
        postMealEndsAt != null && postMealEndsAt > now -> {
            CaptionText(
                text = data?.labels?.timerTitle?.takeIf { it.isNotBlank() }
                    ?: stringResource(id = R.string.post_meal_label),
                color = Ink.Muted
            )
            AccentValue(text = countdown(postMealEndsAt - now))
        }

        reminderAt != null && reminderAt > now -> {
            CaptionText(
                text = data?.labels?.nextReminder?.takeIf { it.isNotBlank() }
                    ?: stringResource(id = R.string.next_reminder_label),
                color = Ink.Muted
            )
            AccentValue(text = clockTime(context, reminderAt))
        }

        else -> {
            CaptionText(
                text = data?.labels?.nextReminder?.takeIf { it.isNotBlank() }
                    ?: stringResource(id = R.string.next_reminder_label),
                color = Ink.Muted
            )
            Text(
                text = stringResource(id = R.string.none),
                color = Ink.Muted,
                maxLines = 1,
                textAlign = TextAlign.Center,
                style = MaterialTheme.typography.bodySmall.copy(
                    fontSize = 16.sp,
                    lineHeight = 19.sp
                )
            )
        }
    }
}

@Composable
private fun CaptionText(text: String, color: Color) {
    Text(
        text = text,
        color = color,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
        textAlign = TextAlign.Center,
        style = MaterialTheme.typography.labelSmall.copy(
            fontSize = 12.sp,
            lineHeight = 15.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 0.4.sp
        )
    )
}

@Composable
private fun AccentValue(text: String) {
    Text(
        text = text,
        color = Ink.Accent,
        maxLines = 1,
        textAlign = TextAlign.Center,
        style = MaterialTheme.typography.numeralSmall.copy(
            fontSize = 21.sp,
            lineHeight = 25.sp,
            fontWeight = FontWeight.SemiBold
        )
    )
}

/** The watch's own 12/24-hour setting, same as the clock on the arc above. */
private fun clockTime(context: Context, epochMs: Long): String =
    DateFormat.getTimeFormat(context).format(Date(epochMs))
