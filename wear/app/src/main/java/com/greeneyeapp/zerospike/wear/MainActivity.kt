package com.greeneyeapp.zerospike.wear

import android.content.Context
import android.os.Bundle
import android.text.format.DateFormat
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.TransformingLazyColumnScope
import androidx.wear.compose.foundation.lazy.TransformingLazyColumnState
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.AppScaffold
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.TimeText
import androidx.wear.compose.material3.screenHeightFraction
import java.util.Date

/**
 * The glance screen: the last logged reading in the app's one glucose colour
 * language, how long ago it was measured, and either the pending post-meal
 * check time or the next pending reminder. The same story, in the same order,
 * as the Apple Watch screen (targets/watch/ContentView.swift), so the two
 * companions read as one product.
 *
 * Descriptive only, exactly like every other glanceable surface: it reports
 * what was already logged on the phone. Reads LiveDataStore, never the phone.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Play WO-V15: installed before super.onCreate so the splash theme
        // (Theme.Zerospike.Starting) is what shows until the first frame.
        installSplashScreen()
        super.onCreate(savedInstanceState)
        LiveDataStore.load(applicationContext)
        setContent { ZerospikeWearApp() }
    }
}

@Composable
private fun ZerospikeWearApp() {
    MaterialTheme(colorScheme = zerospikeColorScheme()) {
        // TimeText is the Wear counterpart of the system clock the Apple Watch
        // keeps in its top corner; AppScaffold hosts it on the arc. ScreenScaffold
        // is handed the SAME TransformingLazyColumnState the list below scrolls
        // with, so it can compute the top content padding from TimeText's real
        // (font-scaled) height instead of a fixed guess, and fade it on scroll.
        AppScaffold(timeText = { TimeText() }) {
            val listState = rememberTransformingLazyColumnState()
            ScreenScaffold(scrollState = listState) { contentPadding ->
                GlanceScreen(listState = listState, contentPadding = contentPadding)
            }
        }
    }
}

@Composable
private fun GlanceScreen(listState: TransformingLazyColumnState, contentPadding: PaddingValues) {
    val context = LocalContext.current
    val data = LiveDataStore.snapshot.value

    // Read once at first composition, not on a running clock: Play WO-V4
    // forbids a self-ticking counter on screen. This value does not refresh
    // again while the same Activity instance is alive.
    val now = remember { System.currentTimeMillis() }

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
                // Play WO-V13: flat black ground, no wash. A colour-matched
                // glow behind the reading (tokens' glow(), so the surface
                // lights up in its own status colour) and the cyan radial at
                // the foot still sit on top of it.
                drawRect(color = Ink.Ground)
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
            }
    ) {
        // A scrollable list, not a fixed Column: at large system font scales
        // (Wear's font_scale up to 1.3) every line below grows past what a
        // round 192dp/227dp screen can show in one static frame. The scaffold's
        // own contentPadding already keeps the first item clear of TimeText.
        TransformingLazyColumn(
            state = listState,
            contentPadding = contentPadding,
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = sidePadding),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            item {
                CaptionText(
                    text = data?.labels?.lastReading?.takeIf { it.isNotBlank() }
                        ?: stringResource(id = R.string.last_reading_label),
                    color = Ink.Muted
                )
            }

            item {
                // The hero. Colour is never the only signal: the value itself and
                // the label above it are always on screen with it. BasicText's
                // autoSize keeps requesting the user's full font-scaled size and
                // only steps the number down when it would not fit the round
                // screen's width - it never overrides the user's chosen scale.
                val heroMaxSize = if (mgdl != null) 52.sp else 34.sp
                BasicText(
                    text = reading,
                    maxLines = 1,
                    overflow = TextOverflow.Clip,
                    style = MaterialTheme.typography.numeralExtraLarge.copy(
                        color = statusColor,
                        fontSize = heroMaxSize,
                        // Tight on purpose: digits carry no descender, and the default
                        // leading pushed the unit line away from the number it belongs to.
                        lineHeight = if (mgdl != null) 52.sp else 38.sp,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center
                    ).ownScriptDirection(),
                    autoSize = TextAutoSize.StepBased(minFontSize = 32.sp, maxFontSize = heroMaxSize)
                )
            }

            if (mgdl != null) {
                item {
                    Text(
                        text = unitLabelOf(data?.unit),
                        color = Ink.Muted,
                        maxLines = 1,
                        textAlign = TextAlign.Center,
                        style = MaterialTheme.typography.bodySmall.copy(
                            fontSize = 13.sp,
                            lineHeight = 16.sp
                        ).ownScriptDirection()
                    )
                }
            }

            item {
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
                    // A scrollable list has room to wrap to a second line, so a
                    // truncated "..." never has to stand in for the real text.
                    overflow = TextOverflow.Clip,
                    textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.bodySmall.copy(
                        fontSize = 14.sp,
                        lineHeight = 17.sp
                    ).ownScriptDirection()
                )
            }

            item { Spacer(modifier = Modifier.height(12.dp)) }
            item {
                Box(
                    modifier = Modifier
                        .width(40.dp)
                        .height(1.dp)
                        .background(Ink.Border)
                )
            }
            item { Spacer(modifier = Modifier.height(10.dp)) }

            upcomingBlockItems(data = data, now = now, context = context)

            // Bottom breathing room as a fraction of the screen, not a fixed dp:
            // it scales with the round screen's own size the same way the rest
            // of the spacing here does.
            item { Spacer(modifier = Modifier.height(screenHeightFraction(0.03f))) }
        }
    }
}

/**
 * The bottom half: an open post-meal window outranks a pending reminder, the
 * same order the lock-screen card uses on the phone. Play WO-V4 forbids a
 * running countdown here, so this prints the fixed clock time the window
 * closes at rather than a ticking remaining-time value.
 *
 * A TransformingLazyColumnScope extension, not a single @Composable: each
 * line becomes its own scrollable list item instead of a fixed-height block,
 * the same reason the rest of GlanceScreen's content moved into items.
 */
private fun TransformingLazyColumnScope.upcomingBlockItems(
    data: LiveDataSnapshot?,
    now: Long,
    context: Context
) {
    val postMealEndsAt = data?.postMealEndsAt
    val postMealStartedAt = data?.postMealStartedAt
    val reminderAt = data?.nextReminderAt

    when {
        postMealEndsAt != null && postMealEndsAt > now -> {
            if (postMealStartedAt != null) {
                item {
                    CaptionText(
                        text = "${
                            data?.labels?.mealTime?.takeIf { it.isNotBlank() }
                                ?: stringResource(id = R.string.meal_time_label)
                        } ${clockTime(context, postMealStartedAt)}",
                        color = Ink.Muted
                    )
                }
            }
            item {
                CaptionText(
                    text = data?.labels?.timerTitle?.takeIf { it.isNotBlank() }
                        ?: stringResource(id = R.string.post_meal_label),
                    color = Ink.Muted
                )
            }
            item { AccentValue(text = clockTime(context, postMealEndsAt)) }
        }

        reminderAt != null && reminderAt > now -> {
            item {
                CaptionText(
                    text = data?.labels?.nextReminder?.takeIf { it.isNotBlank() }
                        ?: stringResource(id = R.string.next_reminder_label),
                    color = Ink.Muted
                )
            }
            item { AccentValue(text = clockTime(context, reminderAt)) }
        }

        else -> {
            item {
                CaptionText(
                    text = data?.labels?.nextReminder?.takeIf { it.isNotBlank() }
                        ?: stringResource(id = R.string.next_reminder_label),
                    color = Ink.Muted
                )
            }
            item {
                Text(
                    text = stringResource(id = R.string.none),
                    color = Ink.Muted,
                    maxLines = 1,
                    textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.bodySmall.copy(
                        fontSize = 16.sp,
                        lineHeight = 19.sp
                    ).ownScriptDirection()
                )
            }
        }
    }
}

/**
 * Every label and value on this screen is either relayed from the phone's own
 * in-app language or picked from this app's strings.xml by the WATCH's system
 * locale - neither is guaranteed to match the ambient layout direction Compose
 * infers from that same system locale. Without this, a line that starts with a
 * weak character (a digit, e.g. "21 min ago") gets dragged to the paragraph's
 * visual end whenever the watch's system language is RTL, even though the
 * content itself is plain Latin/numeral text; Content mode instead looks at
 * the string's own first strong character, so Latin content stays LTR and
 * Arabic content stays RTL regardless of the ambient locale. One place, so
 * every Text/BasicText on this screen resolves direction the same way.
 */
private fun TextStyle.ownScriptDirection(): TextStyle = copy(textDirection = TextDirection.Content)

@Composable
private fun CaptionText(text: String, color: Color) {
    Text(
        text = text,
        color = color,
        maxLines = 2,
        // A scrollable list has room to wrap to a second line, so a truncated
        // "..." never has to stand in for the real (phone-localized) label.
        overflow = TextOverflow.Clip,
        textAlign = TextAlign.Center,
        style = MaterialTheme.typography.labelSmall.copy(
            fontSize = 12.sp,
            lineHeight = 15.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 0.4.sp
        ).ownScriptDirection()
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
        ).ownScriptDirection()
    )
}

/** The watch's own 12/24-hour setting, same as the clock on the arc above. */
private fun clockTime(context: Context, epochMs: Long): String =
    DateFormat.getTimeFormat(context).format(Date(epochMs))
