#!/usr/bin/env python3
"""03-widget for Android.

S7 rewrite: the old lockscreen_scene_android (kept below, still imported by
build_widget_report_tablet.py for its own 03-widget pass - see the module
note on home_widgets_scene_android) drew an iOS-style lock screen: a giant
"9:41" clock and a weekday date. Android has no lock-screen widget surface at
all (app/widget-guide.tsx deliberately hides that whole section on Android),
so that scene was promising a feature the Play build does not have. The panel
now renders what Android actually ships: a home screen carrying several of
the app's six real widgets (lib/services/androidWidget.ts is the source of
truth for every shape/colour below - nothing here is invented) plus the
post-meal countdown's persistent notification (modules/zerospike-live-
activity/android's postmeal-v1 channel), peeking from the shade the way an
ongoing notification actually does."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image, ImageDraw
from compose import (
    new_canvas_with_header, draw_chip_at, draw_device, font, F_BOLD, measure_chip,
    hn, HN_BOLD, HN_MEDIUM, HN_REGULAR, vertical_gradient, rounded_mask,
    fit_header_and_chip, fit_font, verify_output, align_for,
)

THEME_G1 = (7, 13, 19)
THEME_G2 = (16, 34, 44)
ACCENT = (46, 230, 255)
TARGET = (34, 227, 154)
INK = (234, 246, 250)
MUTED = (146, 170, 182)

# ---------------------------------------------------------------------------
# Real widget colours, lifted byte-for-byte from lib/theme/tokens.ts and
# lib/services/androidWidget.ts's own TILE/TILE_INK maps, so the mock cards
# use the exact same fills as the widgets Android actually draws.
# ---------------------------------------------------------------------------
WIDGET_BG_TOP = (15, 32, 41)      # THEME.bg.g2 "#0f2029"
WIDGET_BG_BOTTOM = (8, 14, 20)    # THEME.bg.g1 "#080e14"
WIDGET_INK = (234, 246, 250)      # THEME.ink "#eaf6fa"
WIDGET_MUTED = (137, 163, 176)    # THEME.muted "#89a3b0"
WIDGET_ACCENT = (46, 230, 255)    # THEME.accent "#2ee6ff"
WIDGET_TARGET = (34, 227, 154)    # GLUCOSE_RICH.target "#22e39a"
WIDGET_VIOLET = (124, 92, 255)    # THEME.violet "#7c5cff"
WIDGET_CAUTION = (255, 160, 42)   # THEME.caution / GLUCOSE_COLORS.high "#ffa02a"
TILE_COUNTDOWN = {"fill": (13, 44, 53), "border": (19, 74, 86)}       # "#0d2c35"/"#134a56"
TILE_GLUCOSE_PRIMARY = {"fill": (16, 62, 72), "border": (25, 109, 123)}  # "#103e48"/"#196d7b"
TILE_MEAL = {"fill": (12, 48, 41), "border": (17, 86, 66)}            # "#0c3029"/"#115642"
TILE_INJECTION = {"fill": (27, 26, 58), "border": (47, 41, 100)}      # "#1b1a3a"/"#2f2964"


def lockscreen_scene_android(w, h, time_str, date_str, avg_value, S=None, lang=None):
    """See build_widget.lockscreen_scene for why `lang` reaches only the
    translated labels and never the digits."""
    if S is None:
        from i18n_copy import WIDGET_STRINGS
        S = WIDGET_STRINGS["tr"]
    scene = vertical_gradient((w, h), THEME_G2, THEME_G1)
    draw = ImageDraw.Draw(scene)

    # Android lock-screen clock: bold, medium-large (not ultralight like iOS)
    f_clock = hn(int(w * 0.24), HN_MEDIUM)
    clock_top = int(h * 0.085)
    cw = draw.textlength(time_str, font=f_clock)
    cbbox = draw.textbbox((0, clock_top), time_str, font=f_clock)
    draw.text(((w - cw) / 2, clock_top), time_str, font=f_clock, fill=(255, 255, 255))

    f_date = fit_font(draw, date_str, int(w * 0.86), int(w * 0.040), HN_REGULAR, lang=lang)
    dw = draw.textlength(date_str, font=f_date)
    date_top = cbbox[3] + int(h * 0.018)
    draw.text(((w - dw) / 2, date_top), date_str, font=f_date, fill=MUTED)

    # Ongoing notification (Android's Live-Activity equivalent) - a Material
    # notification-shade card, full width, icon + text + progress.
    n_x0, n_y0 = int(w * 0.055), date_top + int(h * 0.055)
    n_w, n_h = w - 2 * n_x0, int(h * 0.135)
    n_card = vertical_gradient((n_w, n_h), (22, 35, 44), (13, 22, 29))
    nmask = Image.new("L", (n_w, n_h), 0)
    ImageDraw.Draw(nmask).rounded_rectangle([0, 0, n_w - 1, n_h - 1], radius=int(w * 0.045), fill=255)
    scene.paste(n_card, (n_x0, n_y0), nmask)

    icon_size = int(n_h * 0.5)
    icon_x, icon_y = n_x0 + int(w * 0.03), n_y0 + int(w * 0.03)
    icon_grad = vertical_gradient((icon_size, icon_size), (127, 244, 255), (46, 230, 255))
    imask = Image.new("L", (icon_size, icon_size), 0)
    ImageDraw.Draw(imask).rounded_rectangle([0, 0, icon_size - 1, icon_size - 1], radius=int(icon_size * 0.24), fill=255)
    scene.paste(icon_grad, (icon_x, icon_y), imask)
    pts = []
    px, py = icon_x + icon_size * 0.16, icon_y + icon_size * 0.55
    for dx, dy in [(0, 0), (0.16, 0), (0.26, -0.30), (0.38, 0.34), (0.48, 0), (0.70, 0)]:
        pts.append((px + dx * icon_size, py + dy * icon_size))
    draw.line(pts, fill=(3, 24, 28), width=max(3, icon_size // 13), joint="curve")

    tx = icon_x + icon_size + int(w * 0.035)
    bar_x0, bar_x1 = tx, n_x0 + n_w - int(w * 0.03)

    # The Android widget shows the next reminder's target clock TIME, not a
    # countdown (2.1.0 - see lib/services/androidWidget.ts's
    # nextReminderTimeLabel: Android only redraws this periodically, so a
    # "X min left" string goes stale; an absolute time stays true). "12:30"
    # shares the top row with the app line, and the "next reminder" label
    # owns the row under it - same slot the old countdown/title pair used.
    tstr = S["next_reminder_time"]
    f_timer = fit_font(draw, tstr, (bar_x1 - tx) * 0.45, int(w * 0.030), HN_BOLD, lang=lang)
    timer_w = draw.textlength(tstr, font=f_timer)
    f_app = fit_font(draw, S["ongoing"], (bar_x1 - tx) - timer_w - int(w * 0.02),
                     int(w * 0.028), HN_BOLD, lang=lang)
    f_title = fit_font(draw, S["next_reminder"], bar_x1 - tx, int(w * 0.036), HN_BOLD, lang=lang)
    draw.text((tx, n_y0 + int(w * 0.028)), S["ongoing"], font=f_app, fill=ACCENT)
    draw.text((tx, n_y0 + int(w * 0.028) + int(w * 0.045)), S["next_reminder"], font=f_title, fill=INK)
    # No progress bar here any more: a bar reads as "elapsed/remaining
    # fraction", which made sense for a countdown but not for a fixed future
    # clock time - the app's own widget draws no such bar for this label either.
    draw.text((bar_x1 - timer_w, n_y0 + int(w * 0.028)), tstr, font=f_timer, fill=MUTED)

    # Material home-screen widget card, below
    card_x0 = n_x0
    card_y0 = n_y0 + n_h + int(h * 0.03)
    card_w, card_h = n_w, int(h * 0.20)
    card = vertical_gradient((card_w, card_h), (22, 35, 44), (14, 24, 31))
    cmask = Image.new("L", (card_w, card_h), 0)
    ImageDraw.Draw(cmask).rounded_rectangle([0, 0, card_w - 1, card_h - 1], radius=int(w * 0.05), fill=255)
    scene.paste(card, (card_x0, card_y0), cmask)
    # sized off card_h (not w) so the layout stays self-consistent at any
    # aspect ratio - a wide tablet card and a narrow phone card both fit
    # their text without the value overlapping the "Son 7 gün" row.
    pad = int(card_h * 0.13)
    card_inner = card_w - 2 * pad
    f_lbl = fit_font(draw, S["avg_glucose"], card_inner, int(card_h * 0.115), HN_BOLD, lang=lang)
    f_val = hn(int(card_h * 0.34), HN_BOLD)
    f_unit = hn(int(card_h * 0.105), HN_REGULAR)
    f_sub = fit_font(draw, S["last7"], card_inner - int(card_h * 0.09), int(card_h * 0.105),
                     HN_REGULAR, lang=lang)
    label_y = card_y0 + pad
    value_y = label_y + int(card_h * 0.16)
    dot_y = card_y0 + card_h - pad - int(card_h * 0.08)
    draw.text((card_x0 + pad, label_y), S["avg_glucose"], font=f_lbl, fill=MUTED)
    draw.text((card_x0 + pad, value_y), str(avg_value), font=f_val, fill=TARGET)
    vw = draw.textlength(str(avg_value), font=f_val)
    draw.text((card_x0 + pad + vw + 8, value_y + int(card_h * 0.19)), "mg/dL", font=f_unit, fill=MUTED)
    draw.ellipse([card_x0 + pad, dot_y, card_x0 + pad + int(card_h * 0.06), dot_y + int(card_h * 0.06)], fill=TARGET)
    draw.text((card_x0 + pad + int(card_h * 0.09), dot_y - int(card_h * 0.02)), S["last7"], font=f_sub, fill=TARGET)

    hw = int(w * 0.30)
    draw.rounded_rectangle([(w - hw) / 2, h - int(h * 0.012) - 5, (w + hw) / 2, h - int(h * 0.012)],
                            radius=3, fill=(200, 210, 216))
    return scene


def _card(scene, x0, y0, w, h, radius, top=WIDGET_BG_TOP, bottom=WIDGET_BG_BOTTOM):
    """Paste a rounded, top-to-bottom-gradient card - the one shape every
    real widget in lib/services/androidWidget.ts is built from
    (backgroundGradient orientation TOP_BOTTOM, borderRadius)."""
    fill = vertical_gradient((w, h), top, bottom)
    mask = rounded_mask((w, h), radius)
    scene.paste(fill, (x0, y0), mask)


def _tile(scene, x0, y0, w, h, radius, fill, border, border_w=2):
    """A Quick-Add / log-shortcut tile: flat fill + a 1px hairline border, the
    two pre-mixed opaque colours from androidWidget.ts's TILE map (the
    library's native colour parser only reads #rrggbb, so the real widget
    cannot use a translucent border either - see that file's own comment)."""
    mask = rounded_mask((w, h), radius)
    layer = Image.new("RGB", (w, h), fill)
    scene.paste(layer, (x0, y0), mask)
    d = ImageDraw.Draw(scene)
    d.rounded_rectangle([x0, y0, x0 + w - 1, y0 + h - 1], radius=radius, outline=border, width=border_w)


def _plus_glyph(draw, cx, cy, size, color, width):
    draw.line([(cx - size / 2, cy), (cx + size / 2, cy)], fill=color, width=width)
    draw.line([(cx, cy - size / 2), (cx, cy + size / 2)], fill=color, width=width)


def home_widgets_scene_android(w, h, WL, S=None, lang=None):
    """The Android home screen the panel actually ships: a status bar (no
    lock-screen clock - Android's home screen never shows one unless the user
    places a clock widget, which this mock does not claim), the post-meal
    countdown's persistent notification peeking from the shade, then five of
    the app's six real home-screen widgets stacked the way a user who added
    several of them would see them. Every shape/colour is read from
    lib/services/androidWidget.ts's own builders (buildZerospikeWidget,
    buildReadingWidget, buildQuickAddWidget, buildLogGlucoseWidget/
    buildLogMealWidget, buildTimerWidget) and lib/theme/tokens.ts - see the
    WIDGET_BG_*/WIDGET_*/TILE_* constants above, copied from there byte for
    byte. `lang` only ever reaches translated labels, never the demo digits
    (same rule as lockscreen_scene_android)."""
    if S is None:
        from i18n_copy import WIDGET_STRINGS
        S = WIDGET_STRINGS["en"]
    scene = Image.new("RGB", (w, h), (18, 22, 27))
    # A soft two-tone wallpaper wash (not a screenshot of any real launcher -
    # this mock does not claim a specific OEM skin), just enough to read as a
    # home screen behind the widgets rather than a flat colour block.
    wall = vertical_gradient((w, h), (24, 30, 37), (11, 14, 18))
    scene.paste(wall, (0, 0))
    draw = ImageDraw.Draw(scene)

    margin = int(w * 0.045)
    radius = int(w * 0.06)

    # ---- status bar: small clock only, no OS icons invented, no lock-screen
    # clock. A home screen's status bar looks like this whether or not the
    # device is locked; this mock is careful not to reintroduce iOS's giant
    # centred lock-screen time. ----
    f_status = hn(int(h * 0.024), HN_MEDIUM)
    draw.text((margin, int(h * 0.018)), "9:41", font=f_status, fill=WIDGET_INK)

    # ---- persistent notification peek (postmeal-v1) - PostMealNotification.kt:
    # setContentTitle(widget.timerTitle), setContentText("123 mg/dL"),
    # setUsesChronometer(true) + setChronometerCountDown(true) for the
    # top-right remaining time. A short pull-handle above it reads as "this
    # is the notification shade", not the lock screen. ----
    handle_y = int(h * 0.052)
    handle_w = int(w * 0.14)
    draw.rounded_rectangle(
        [(w - handle_w) / 2, handle_y, (w + handle_w) / 2, handle_y + max(3, int(h * 0.004))],
        radius=3, fill=(120, 132, 140),
    )
    notif_y0 = handle_y + int(h * 0.018)
    notif_h = int(h * 0.115)
    _card(scene, margin, notif_y0, w - 2 * margin, notif_h, int(w * 0.05),
          top=(26, 34, 41), bottom=(16, 21, 26))
    icon_size = int(notif_h * 0.42)
    icon_x, icon_y = margin + int(w * 0.03), notif_y0 + (notif_h - icon_size) // 2
    icon_grad = vertical_gradient((icon_size, icon_size), (127, 244, 255), WIDGET_ACCENT)
    scene.paste(icon_grad, (icon_x, icon_y), rounded_mask((icon_size, icon_size), int(icon_size * 0.26)))
    ipts = []
    ipx, ipy = icon_x + icon_size * 0.18, icon_y + icon_size * 0.55
    for dx, dy in [(0, 0), (0.14, 0), (0.24, -0.28), (0.36, 0.32), (0.46, 0), (0.64, 0)]:
        ipts.append((ipx + dx * icon_size, ipy + dy * icon_size))
    draw.line(ipts, fill=(3, 24, 28), width=max(2, icon_size // 14), joint="curve")

    row_x = icon_x + icon_size + int(w * 0.03)
    row_right = margin + (w - 2 * margin) - int(w * 0.03)
    f_app = fit_font(draw, "zerospike", (row_right - row_x) * 0.5, int(h * 0.016), HN_BOLD, lang=lang)
    app_w = draw.textlength("zerospike", font=f_app)
    f_cd = fit_font(draw, WL["countdown_demo"], (row_right - row_x) - app_w - int(w * 0.02),
                     int(h * 0.017), HN_BOLD, lang=lang)
    draw.text((row_x, notif_y0 + int(notif_h * 0.14)), "zerospike", font=f_app, fill=WIDGET_ACCENT)
    draw.text((row_right - draw.textlength(WL["countdown_demo"], font=f_cd), notif_y0 + int(notif_h * 0.14)),
              WL["countdown_demo"], font=f_cd, fill=WIDGET_MUTED)
    f_ntitle = fit_font(draw, WL["timer_title"], row_right - row_x, int(h * 0.021), HN_BOLD, lang=lang)
    draw.text((row_x, notif_y0 + int(notif_h * 0.40)), WL["timer_title"], font=f_ntitle, fill=WIDGET_INK)
    f_nbody = fit_font(draw, "123 mg/dL", row_right - row_x, int(h * 0.018), HN_REGULAR, lang=lang)
    draw.text((row_x, notif_y0 + int(notif_h * 0.66)), "123 mg/dL", font=f_nbody, fill=WIDGET_MUTED)

    # ---- layout constants below are deliberately h-based for EVERY vertical
    # measurement (gaps, padding, font sizes) and w-based only for horizontal
    # ones. Mixing a w-based pad into a vertical offset was the S7 bug: tablet7/
    # tablet10's content_h is much shorter relative to their raw width than the
    # phone's (aspect ~1.45-1.49 vs ~2.03), so a horizontal-margin-sized vertical
    # gap ate a much bigger slice of a card's own (h-based) height there,
    # crushing the value/next-reminder text into each other. Every card below
    # also derives its own height bottom-up from its real content instead of a
    # preset fraction, so it cannot under-book its own text regardless of the
    # canvas's aspect ratio. ----
    vpad = int(h * 0.02)
    hpad = int(w * 0.045)
    hpad2 = int(w * 0.035)
    row_gap = int(h * 0.02)

    # ---- Zerospike glance widget: avg glucose + next-reminder pill, exactly
    # buildZerospikeWidget's own layout and copy. Card height is derived from
    # the content BEFORE the card itself is drawn (_card pastes an opaque
    # fill through a mask - drawing it after the text would blank the text
    # right back out), so every size below is fixed first and only then drawn. ----
    y = notif_y0 + notif_h + row_gap
    card_x, card_w = margin, w - 2 * margin
    f_lbl = fit_font(draw, WL["avg_glucose"], card_w - 2 * hpad, int(h * 0.019), HN_BOLD, lang=lang)
    f_val = hn(int(h * 0.05), HN_BOLD)
    f_unit = hn(int(h * 0.017), HN_REGULAR)
    f_nr_lbl = fit_font(draw, S["next_reminder"], card_w - 2 * hpad, int(h * 0.016), HN_BOLD, lang=lang)
    f_nr_time = hn(int(h * 0.019), HN_BOLD, lang=lang)
    nr_time = S["next_reminder_time"]
    nr_tw = draw.textlength(nr_time, font=f_nr_time)
    pill_w, pill_h = int(nr_tw + w * 0.05), int(h * 0.032)

    label_y = y + vpad
    value_y = label_y + int(f_lbl.size * 1.25) + int(h * 0.012)
    nr_lbl_y = value_y + int(f_val.size * 1.15) + int(h * 0.016)
    pill_y = nr_lbl_y + int(f_nr_lbl.size * 1.3) + int(h * 0.008)
    glance_h = (pill_y + pill_h + vpad) - y

    _card(scene, card_x, y, card_w, glance_h, radius)
    draw.text((card_x + hpad, label_y), WL["avg_glucose"], font=f_lbl, fill=WIDGET_MUTED)
    draw.text((card_x + hpad, value_y), "123", font=f_val, fill=WIDGET_TARGET)
    vw = draw.textlength("123", font=f_val)
    draw.text((card_x + hpad + vw + int(w * 0.012), value_y + int(f_val.size * 0.4)),
              "mg/dL", font=f_unit, fill=WIDGET_MUTED)
    draw.text((card_x + hpad, nr_lbl_y), S["next_reminder"], font=f_nr_lbl, fill=WIDGET_MUTED)
    _tile(scene, card_x + hpad, pill_y, pill_w, pill_h, pill_h // 2,
          TILE_COUNTDOWN["fill"], TILE_COUNTDOWN["border"], border_w=1)
    draw.text((card_x + hpad + (pill_w - nr_tw) / 2, pill_y + (pill_h - f_nr_time.size) / 2 - 1),
              nr_time, font=f_nr_time, fill=WIDGET_ACCENT)

    # ---- two-column row: ZerospikeReading (last value) + ZerospikeTimer
    # (RUNNING face) - buildReadingWidget and buildTimerWidget's running branch. ----
    y += glance_h + row_gap
    col_w = (w - 2 * margin - int(w * 0.03)) // 2
    f_rlbl = fit_font(draw, WL["last_reading"], col_w - 2 * hpad2, int(h * 0.015), HN_BOLD, lang=lang)
    f_rval = hn(int(h * 0.034), HN_BOLD)
    f_runit = hn(int(h * 0.014), HN_REGULAR)
    row_h = vpad + int(f_rlbl.size * 1.3) + int(h * 0.02) + int(f_rval.size * 1.15) + vpad
    # ZerospikeReading
    _card(scene, margin, y, col_w, row_h, radius)
    ry = y + vpad
    draw.text((margin + hpad2, ry), WL["last_reading"], font=f_rlbl, fill=WIDGET_MUTED)
    val_y2 = y + row_h - vpad - int(f_rval.size * 1.05)
    draw.text((margin + hpad2, val_y2), "112", font=f_rval, fill=WIDGET_TARGET)
    rvw = draw.textlength("112", font=f_rval)
    draw.text((margin + hpad2 + rvw + int(w * 0.01), val_y2 + int(f_rval.size * 0.32)),
              "mg/dL", font=f_runit, fill=WIDGET_MUTED)
    # ZerospikeTimer (running)
    tx0 = margin + col_w + int(w * 0.03)
    _card(scene, tx0, y, col_w, row_h, radius)
    f_tlbl = fit_font(draw, WL["timer_title"], col_w - 2 * hpad2, int(h * 0.015), HN_BOLD, lang=lang)
    draw.text((tx0 + hpad2, ry), WL["timer_title"], font=f_tlbl, fill=WIDGET_MUTED)
    f_tpill = hn(int(h * 0.022), HN_BOLD, lang=lang)
    tpill_text = S["next_reminder_time"]
    tpill_tw = draw.textlength(tpill_text, font=f_tpill)
    tpill_w, tpill_h = int(tpill_tw + w * 0.045), int(h * 0.034)
    tpill_y = y + row_h - vpad - tpill_h
    _tile(scene, tx0 + hpad2, tpill_y, tpill_w, tpill_h, tpill_h // 2,
          TILE_COUNTDOWN["fill"], TILE_COUNTDOWN["border"], border_w=1)
    draw.text((tx0 + hpad2 + (tpill_w - tpill_tw) / 2, tpill_y + (tpill_h - f_tpill.size) / 2 - 1),
              tpill_text, font=f_tpill, fill=WIDGET_ACCENT)

    # ---- ZerospikeQuickAdd: glucose (primary) / meal / injection tiles,
    # quickAddShortcuts' default order and weights (med excluded - opt-in,
    # off by default, same as the real widget with no snapshot flag set). ----
    y += row_h + row_gap
    f_qlbl = fit_font(draw, WL["quick_add"], card_w - 2 * hpad2, int(h * 0.015), HN_BOLD, lang=lang)
    tiles_h = int(h * 0.09)
    qa_h = vpad + int(f_qlbl.size * 1.3) + int(h * 0.014) + tiles_h + vpad
    _card(scene, margin, y, card_w, qa_h, radius)
    draw.text((margin + hpad2, y + vpad), WL["quick_add"], font=f_qlbl, fill=WIDGET_MUTED)
    tiles_y = y + vpad + int(f_qlbl.size * 1.3) + int(h * 0.014)
    gutter = int(w * 0.02)
    weights = [4, 3, 3]
    tile_inks = [WIDGET_ACCENT, WIDGET_TARGET, WIDGET_VIOLET]
    tile_fills = [TILE_GLUCOSE_PRIMARY, TILE_MEAL, TILE_INJECTION]
    tile_labels = [WL["add_glucose"], WL["add_meal"], WL["add_injection"]]
    avail = card_w - 2 * hpad2 - gutter * (len(weights) - 1)
    tx = margin + hpad2
    for wgt, ink, fills, label in zip(weights, tile_inks, tile_fills, tile_labels):
        tw_ = int(avail * wgt / sum(weights))
        _tile(scene, tx, tiles_y, tw_, tiles_h, int(w * 0.035), fills["fill"], fills["border"], border_w=1)
        _plus_glyph(draw, tx + tw_ / 2, tiles_y + tiles_h * 0.36, tiles_h * 0.28, ink, max(2, int(tiles_h * 0.06)))
        f_tl = fit_font(draw, label, tw_ - int(w * 0.01), int(h * 0.013), HN_BOLD, lang=lang)
        tlw = draw.textlength(label, font=f_tl)
        draw.text((tx + (tw_ - tlw) / 2, tiles_y + tiles_h * 0.68), label, font=f_tl, fill=WIDGET_INK)
        tx += tw_ + gutter

    # ---- two-column row: ZerospikeLogGlucose / ZerospikeLogMeal - the shared
    # buildLogShortcutWidget shape, content bottom-anchored (justifyContent
    # flex-end in the real widget). ----
    y += qa_h + row_gap
    box = int(h * 0.052)
    f_ll = hn(int(h * 0.017), HN_BOLD, lang=lang)
    log_h = vpad + box + int(h * 0.012) + int(f_ll.size * 1.3) + vpad
    for i, (label, ink, fills) in enumerate([
        (WL["add_glucose"], WIDGET_ACCENT, TILE_GLUCOSE_PRIMARY),
        (WL["add_meal"], WIDGET_TARGET, TILE_MEAL),
    ]):
        lx0 = margin + i * (col_w + int(w * 0.03))
        _card(scene, lx0, y, col_w, log_h, radius)
        box_y = y + vpad
        _tile(scene, lx0 + hpad2, box_y, box, box, int(box * 0.28), fills["fill"], fills["border"], border_w=1)
        _plus_glyph(draw, lx0 + hpad2 + box / 2, box_y + box / 2, box * 0.42, ink, max(2, int(box * 0.09)))
        f_ll_i = fit_font(draw, label, col_w - 2 * hpad2, int(h * 0.017), HN_BOLD, lang=lang)
        draw.text((lx0 + hpad2, box_y + box + int(h * 0.012)), label, font=f_ll_i, fill=WIDGET_INK)
    y += log_h

    # ---- a plain launcher dock (generic rounded squares, not any real app's
    # icon) plus the gesture-nav pill, just enough to read as "home screen"
    # rather than a floating stack of cards. Anchored to whichever is lower:
    # a fixed distance from the bottom edge, or just under the last card
    # above (derived card heights can leave more/less slack than a fixed
    # layout would, depending on the canvas's aspect ratio). ----
    dock_h = int(h * 0.05)
    dock_y = max(h - int(h * 0.075) - dock_h, y + row_gap)
    n_dock = 4
    dgutter = int(w * 0.035)
    davail = (w - 2 * margin) - dgutter * (n_dock - 1)
    dw_ = davail // n_dock
    dx = margin
    for _ in range(n_dock):
        mask = rounded_mask((dw_, dock_h), int(w * 0.03))
        layer = Image.new("RGB", (dw_, dock_h), (40, 46, 53))
        scene.paste(layer, (dx, dock_y), mask)
        dx += dw_ + dgutter
    hw = int(w * 0.28)
    draw.rounded_rectangle(
        [(w - hw) / 2, h - int(h * 0.022), (w + hw) / 2, h - int(h * 0.022) + max(3, int(h * 0.004))],
        radius=3, fill=(200, 210, 216),
    )
    return scene


OUT_ROOT = "/Users/muhammedbozkurt/Desktop/Others/zerospike/zerospike-store"

# S7: one entry per Android form factor. dev_y/bezel/radius/margin_x are
# copied verbatim from that form factor's own 01-ring geometry
# (build_android_phone.py's DEV_Y/BEZEL/RADIUS/BASE["margin_x"];
# build_android_tablet.py's CANVASES dev_y/bezel/radius/margin_x) - the
# ticket's own requirement (d) that 03-widget's device frame stand the same
# height as every other panel's. raw_w/content_h are that same form factor's
# 01-ring content dimensions (build_android_phone.CONTENT_H+STATUS_BAND;
# build_android_tablet's tabbar_top-status_crop+STATUS_BAND) - rendering the
# scene at exactly that pixel size, then letting draw_device scale it to
# dev_w-2*bezel the same way it scales a real capture, reproduces 01-ring's
# own dev_h to the pixel (same inputs, same formula) without importing
# anything from those two files (which this ticket does not list as
# read-write for this script).
CANVASES = [
    dict(name="android-phone-1080x1920", canvas=(1080, 1920), dev_y=388, bezel=13, radius=52,
         margin_x=54, raw_w=1080, content_h=2196, headline_size=70, sub_size=30, chip_size=27,
         punch="phone"),
    dict(name="android-tablet7-1080x1920", canvas=(1080, 1920), dev_y=360, bezel=11, radius=42,
         margin_x=48, raw_w=1200, content_h=1740, headline_size=58, sub_size=25, chip_size=22,
         punch="tablet"),
    dict(name="android-tablet10-1600x2560", canvas=(1600, 2560), dev_y=480, bezel=14, radius=56,
         margin_x=70, raw_w=1600, content_h=2380, headline_size=76, sub_size=33, chip_size=29,
         punch="tablet"),
]


def build_for_canvas(lang, spec):
    from i18n_copy import WIDGET_STRINGS, WIDGET_LABELS, android_copy_for
    OUT = os.path.join(OUT_ROOT, spec["name"], lang)
    os.makedirs(OUT, exist_ok=True)
    CANVAS = spec["canvas"]
    BASE = dict(canvas=CANVAS, margin_x=spec["margin_x"], headline_top=spec["margin_x"],
                headline_size=spec["headline_size"], sub_size=spec["sub_size"],
                chip_size=spec["chip_size"], text_w=int(CANVAS[0] * 0.80))
    headline, sub, chip_text = android_copy_for(lang, "03-widget")
    WS = WIDGET_STRINGS[lang]
    WL = WIDGET_LABELS[lang]
    cfg = dict(BASE, headline=headline, sub=sub, lang=lang, align=align_for(lang))

    DEV_Y = spec["dev_y"]
    BEZEL = spec["bezel"]
    RADIUS = spec["radius"]
    DEV_W = CANVAS[0] - 2 * spec["margin_x"]

    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    f_chip = font(F_BOLD, cfg["chip_size"], lang=lang)
    # compose.measure_chip's `extra` (the space reserved past the text) only
    # ever accounts for emoji_ch, not the dot= this panel's chip actually uses
    # (see draw_chip_at: the dot's 2*r+12 offset shifts the text start but
    # never grows the pill it is measured against), so a dot chip's own text
    # lands only ~4px from the pill's rounded cap - visually clipped for a
    # chip this long. Two trailing spaces (part of the string both calls
    # below measure and draw) buy back that clearance without touching
    # compose.py's shared measure_chip/draw_chip_at.
    chip_render = chip_text + "  "
    chip_w, chip_h, *_ = measure_chip(probe, chip_render, f_chip, None)
    gap = int(spec["margin_x"] * 0.4)
    pad = int(spec["margin_x"] * 0.15)
    cfg["sub_max_lines"], chip_y, fits = fit_header_and_chip(cfg, chip_h, DEV_Y, gap, pad)
    if not fits:
        print(f"  WARN [{lang}] {spec['name']} 03-widget chip overlaps the header band")

    canvas, draw, y_after = new_canvas_with_header(cfg)
    # Rendered at the raw capture's own content size, not the output canvas's -
    # see the CANVASES doc comment above for why this reproduces 01-ring's dev_h.
    scene = home_widgets_scene_android(spec["raw_w"], spec["content_h"], WL, S=WS, lang=lang)
    dev_x = (CANVAS[0] - DEV_W) // 2
    dev_box = draw_device(canvas, scene, dev_x, DEV_Y, DEV_W, BEZEL, RADIUS)
    d2 = ImageDraw.Draw(canvas)
    cx = dev_x + DEV_W // 2
    if spec["punch"] == "phone":
        cy, r = DEV_Y + BEZEL + 24, 9
        d2.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(3, 3, 4))
        d2.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(40, 40, 44), width=1)
    else:
        cy = DEV_Y + BEZEL + int(BEZEL * 1.6)
        r = max(6, int(BEZEL * 0.6))
        d2.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(3, 3, 4))

    chip_x = (CANVAS[0] - chip_w) // 2 if cfg["align"] == "center" else CANVAS[0] - cfg["margin_x"] - chip_w
    draw_chip_at(canvas, chip_render, chip_x, chip_y, f_chip, dot=(46, 230, 255))

    out_path = os.path.join(OUT, "03-widget.png")
    canvas.save(out_path)
    print("wrote", out_path, canvas.size, "dev_box", dev_box)
    return [(out_path, CANVAS)]


def build_all(lang):
    written = []
    for spec in CANVASES:
        written += build_for_canvas(lang, spec)
    return written


def main(argv):
    from i18n_copy import LANGS
    langs = argv[1:] or list(LANGS)
    if langs == ["all"]:
        langs = list(LANGS)
    written = []
    for lang in langs:
        written += build_all(lang)
    bad = [p for p, size in written if not verify_output(p, size)]
    print(f"{len(written)} file(s): {len(written) - len(bad)} OK, {len(bad)} FAIL")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
