package com.greeneyeapp.zerospike.wear

import androidx.compose.ui.graphics.Color
import androidx.wear.compose.material3.ColorScheme

/**
 * The zerospike design language on Wear OS.
 *
 * Every value here is a literal from lib/theme/tokens.ts, the app's single
 * source of colour for all of its surfaces (app screens, the doctor report,
 * the home widgets, the Apple Watch app). Nothing is picked by eye, and the
 * Kotlin side owns no colour the phone does not also own - a token that
 * changes there is meant to be changed here by hand, in the same hex.
 */
object Ink {
    /** Play WO-V13: black background required for all Wear OS apps and
     *  tiles. Pure black here, not THEME.bg.g1 - this token intentionally
     *  diverges from the phone/iOS ground literal. */
    val Ground = Color(0xFF000000)
    /** THEME.ink - primary text. */
    val Primary = Color(0xFFEAF6FA)
    /** THEME.muted - secondary text. */
    val Muted = Color(0xFF89A3B0)
    /** THEME.accent - the cyan brand highlight. */
    val Accent = Color(0xFF2EE6FF)
    /** THEME.bg.glowCyan - the soft cyan radial at the bottom of the wash. */
    val GlowCyan = Color(0x1F2EE6FF)
    /** THEME.border. */
    val Border = Color(0x1AFFFFFF)
    /** THEME.sheet - the opaque elevated surface. */
    val Sheet = Color(0xFF16232E)
}

/**
 * GLUCOSE_COLORS in lib/theme/tokens.ts. One mapping, identical on every
 * surface: low rose, normal mint, elevated yellow, high amber, veryHigh deep
 * orange. Colour is never the only signal here - the screen always prints the
 * numeric value and its label beside it.
 */
object GlucoseInk {
    val Low = Color(0xFFFF5468)
    val Normal = Color(0xFF22E39A)
    val Elevated = Color(0xFFFFD23F)
    val High = Color(0xFFFFA02A)
    val VeryHigh = Color(0xFFFF8A00)
}

/**
 * Which of those a reading gets, from the profile's OWN band as it arrives in
 * the snapshot (lib/services/liveData.ts writes hypo/low/high/veryHigh from the
 * user's target range) - never from a threshold invented on this side. The
 * ladder is the same one classifyGlucose applies in the app and ContentView.swift
 * applies on the Apple Watch, so a value can never be coloured two ways across
 * the two watches. The 70/180/250 fallbacks are only for a snapshot written
 * before `band` existed.
 */
fun glucoseColorFor(mgdl: Double, band: LiveDataSnapshot.Band?): Color {
    val hypo = band?.hypo?.takeIf { it > 0 } ?: 70.0
    val high = band?.high?.takeIf { it > 0 } ?: 180.0
    val veryHigh = band?.veryHigh?.takeIf { it > 0 } ?: 250.0
    if (mgdl < hypo) return GlucoseInk.Low
    if (mgdl >= veryHigh) return GlucoseInk.VeryHigh
    if (mgdl <= high) return GlucoseInk.Normal
    if (mgdl <= high * 1.25) return GlucoseInk.Elevated
    return GlucoseInk.High
}

/** mg/dL or mmol/L, from the snapshot's own unit field. Not translatable. */
fun unitLabelOf(unit: String?): String = if (unit == "mmol") "mmol/L" else "mg/dL"

/**
 * "38 min ago", composed from the labels the PHONE already localized
 * (widget.hourShort / minuteShort / agoTemplate). Deliberately not
 * DateUtils.getRelativeTimeSpanString: that formatter speaks the WATCH's system
 * language, which can differ from the in-app language the user picked on the
 * phone, and the two halves of one sentence would then disagree. Returns null
 * when the snapshot predates those labels, so the caller can fall back to a
 * plain clock time.
 */
fun relativeAgo(elapsedMs: Long, labels: LiveDataSnapshot.Labels?): String? {
    if (labels == null) return null
    val template = labels.agoTemplate.takeIf { it.isNotBlank() } ?: return null
    val hourShort = labels.hourShort.takeIf { it.isNotBlank() } ?: return null
    val minuteShort = labels.minuteShort.takeIf { it.isNotBlank() } ?: return null
    val totalMinutes = (elapsedMs / 60_000L).coerceAtLeast(0L)
    val hours = totalMinutes / 60
    val minutes = totalMinutes % 60
    val duration =
        if (hours > 0) "$hours $hourShort $minutes $minuteShort" else "$minutes $minuteShort"
    return template.replace("{{t}}", duration)
}

/**
 * The Wear Material 3 scheme re-pointed at the tokens above, so the pieces the
 * app does not colour by hand (the scaffold ground, TimeText, the default text
 * colour) land on the brand ground instead of the platform's plain black.
 */
fun zerospikeColorScheme(): ColorScheme = ColorScheme(
    primary = Ink.Accent,
    onPrimary = Ink.Ground,
    background = Ink.Ground,
    onBackground = Ink.Primary,
    surfaceContainer = Ink.Sheet,
    onSurface = Ink.Primary,
    onSurfaceVariant = Ink.Muted,
    outline = Ink.Border
)
