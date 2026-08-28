#!/usr/bin/env python3
"""Android phone composites, built from real Android phone captures.

2.0.0 reused the iPhone raws with the iOS status bar cropped away, because
there was no Android capture pass yet. There now is one
(raw/android-phone/<lang>/*.png, 1080x2400, real emulator screenshots), so
this build reads its own raw set instead of borrowing iPhone pixels. All the
crop constants below were measured directly on those captures (row-by-row
pixel inspection, cross-checked against all 9 languages), not carried over
from build_iphone.py - the two raw sets differ in resolution and in exactly
where the OS chrome and the app's own tab bar sit, so iPhone's pixel anchors
do not transfer."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image, ImageDraw
from compose import (
    new_canvas_with_header, draw_device, load_cropped_shot, font, F_BOLD,
    measure_chip, bodymap_shot, fit_header_and_chip, verify_output, align_for,
    pad_to_height, layout_chips, draw_chips,
)
from i18n_copy import LANGS, PANELS_2_0_0 as _ALL_PANELS, chips_for

# Lets a single panel be re-rendered on its own (env var, comma-separated
# panel keys) without touching the other 6 - needed once 09-reminders gets
# a fresh raw capture pass (permission banner hidden, list seeded fuller)
# and only it needs to be rebuilt across all 9 languages.
import os as _os
_filter = _os.environ.get("PANEL_FILTER")
PANELS_2_0_0 = tuple(p for p in _ALL_PANELS if p in _filter.split(",")) if _filter else _ALL_PANELS

RAW_BASE = "/Users/muhammedbozkurt/Desktop/Others/zerospike/raw/android-phone"
OUT_BASE = "/Users/muhammedbozkurt/Desktop/Others/zerospike/zerospike-store/android-phone-1080x1920"

CANVAS = (1080, 1920)
BASE = dict(
    canvas=CANVAS, margin_x=54, headline_top=54, headline_size=70, sub_size=30,
    chip_size=27, text_w=int(CANVAS[0] * 0.80),
)
DEV_Y = 388
DEV_W_STD = CANVAS[0] - 2 * BASE["margin_x"]
BEZEL = 13
RADIUS = 52
SAFE_BOTTOM = CANVAS[1] - 20

# Measured on raw/android-phone/*/01-ring.png (1080x2400): the OS status icons
# (clock/wifi/battery) end at y=48 and the app's own header row (the sparkle/
# asterisk buttons, the tallest element in the header) starts at y=64 - 55
# sits in that gap in every one of the 9 languages, so the whole status bar is
# gone and no app content is clipped.
STATUS_CROP = 55
# The cropped frame would otherwise start flush with the app header, leaving
# the drawn punch-hole camera sitting on top of a button. Re-open a plain
# strip built from the shot's own top row (real background, no invented clock
# or battery glyphs) just tall enough to clear the hole (drawn at
# BEZEL+24+-radius, see add_punch_hole).
STATUS_BAND = 40

# The app's own bottom tab bar: its background starts at y=2211 in every one
# of the 9 languages (verified per-language, see scratchpad notes) - stable
# because it is fixed chrome, not translated content.
TABBAR_TOP = 2211
TARGET_CROP_H = TABBAR_TOP
CONTENT_H = TARGET_CROP_H - STATUS_CROP

# 05-insights has no tab bar of its own, so its content does not naturally
# stop at TARGET_CROP_H the way the other panels' does - it is padded up to
# that same CONTENT_H afterwards purely for device-rect uniformity (see
# PAD_PANELS). That padded shot then goes through the exact same geometry as
# every other panel (DEV_Y, this canvas's own height, BEZEL, DEV_W_STD), and
# that geometry only ever shows this many raw px of a CONTENT_H-tall shot
# before the device bleeds off the bottom of the canvas - the same bleed
# 01-ring's own last card row already relies on landing in a gap for (see
# draw_device; canvas.paste silently clips whatever falls past CANVAS[1]).
# Snapping 05-insights toward THIS row instead of TABBAR_TOP keeps the crop
# from bisecting a card at the edge that is actually shown - anything the
# capture has beyond it is real content that would just be bled off anyway,
# chosen as the snap target or not (verified broken before this fix: the
# "TIME IN RANGE"/"READINGS" card row landed half past this line and was cut
# off mid-card).
_insights_scale = (DEV_W_STD - 2 * BEZEL) / 1080  # raw capture width
_insights_visible_shot_px = (CANVAS[1] - DEV_Y - BEZEL) / _insights_scale
INSIGHTS_VISIBLE_CUTOFF = STATUS_CROP + round(_insights_visible_shot_px - STATUS_BAND)

# 07-spike's chat composer bottom edge (+ margin), measured on the raw
# captures and confirmed stable across all 9 languages (pinned bottom
# element, not affected by translated text length). Neither screen has the
# app tab bar, so both get their own EXCEPTION_PANELS handling instead of
# TARGET_CROP_H.
SPIKE_COMPOSER_BOTTOM = 2320
# 08-takip crop_top = this minus CONTENT_H, so it has to clear the
# back-chevron/language-pill row as a whole (content y=95-158 in every
# language) - 2260 (crop_top=104) landed inside that range and left the
# pill's rounded top corner looking flat-cut instead of just losing a hairline
# sliver. 2320 (crop_top=164) clears it, and still frames the progress bar
# (y=183) and the skip-link (ends by y=2249) fully, with margin below the
# gesture-nav pill at y=2364.
TAKIP_FOOTER_BOTTOM = 2320

# 01-ring/02-bodymap/04-food/09-reminders all read as clean background (or,
# for 01-ring, a fully-framed hint line) at TARGET_CROP_H in every language -
# confirmed by sampling all 9 raw captures - so they crop there directly with
# no padding. 05-insights is a pushed detail screen with no tab bar of its
# own; its last card's end varies a lot by language (a two-column layout on
# this canvas), so it is the one panel that needs a per-capture snap plus
# padding up to CONTENT_H.
CROP_BOTTOM = {
    "01-ring": TARGET_CROP_H,
    "02-bodymap": TARGET_CROP_H,
    "04-food": TARGET_CROP_H,
    "05-insights": INSIGHTS_VISIBLE_CUTOFF,
    "07-spike": SPIKE_COMPOSER_BOTTOM,   # EXCEPTION, see load_shot
    "08-takip": TAKIP_FOOTER_BOTTOM,     # EXCEPTION, see load_shot
    "09-reminders": TARGET_CROP_H,
}
SNAP_PANELS = {"05-insights"}
# All 9 languages land within ~15px of INSIGHTS_VISIBLE_CUTOFF already; kept
# generous so a future copy change that shifts a card by more than that still
# finds the next gap up instead of falling back to an unsnapped (possibly
# mid-card) cut.
SNAP_WINDOW = 450
PAD_PANELS = {"05-insights"}
EXCEPTION_PANELS = {"07-spike", "08-takip"}

# Measured minimum gap between the chip block's bottom edge and the device
# frame's top edge - see build_iphone.CHIP_DEV_GAP, scaled by this canvas's
# own width relative to the iPhone canvas (1284px) it was baselined against.
CHIP_DEV_GAP = round(24 * CANVAS[0] / 1284)


def add_punch_hole(canvas, dev_x, dev_y, dev_w):
    d = ImageDraw.Draw(canvas)
    cx = dev_x + dev_w // 2
    cy = dev_y + BEZEL + 24
    r = 9
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(3, 3, 4))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(40, 40, 44), width=1)


def place_device_and_chips(cfg, shot_img, chips):
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    f_chip = font(F_BOLD, cfg["chip_size"], lang=cfg.get("lang"))
    available_w = CANVAS[0] - 2 * cfg["margin_x"]
    orientation, block_w, block_h, boxes = layout_chips(probe, chips, f_chip, available_w, gap_y=14)
    sub_lines, cy, fits = fit_header_and_chip(cfg, block_h, DEV_Y, 18, CHIP_DEV_GAP)
    if not fits:
        print(f"  WARN [{cfg.get('lang')}] chip overlaps the header band")
    cfg = dict(cfg, sub_max_lines=sub_lines)

    canvas, draw, y_after = new_canvas_with_header(cfg)
    dev_w = DEV_W_STD
    dev_x = (CANVAS[0] - dev_w) // 2
    dev_box = draw_device(canvas, shot_img, dev_x, DEV_Y, dev_w, BEZEL, RADIUS)
    add_punch_hole(canvas, dev_x, DEV_Y, dev_w)
    draw_chips(canvas, draw, chips, cfg, f_chip, cy, orientation, boxes, gap_y=14)
    return canvas, dev_box


def frame(out_dir, key, cfg, chips, shot):
    canvas, dev_box = place_device_and_chips(cfg, shot, chips)
    out_path = os.path.join(out_dir, f"{key}.png")
    canvas.save(out_path)
    print("wrote", out_path, canvas.size, "dev_box", dev_box, "content", shot.size)
    return out_path


def with_status_band(shot, band_h=STATUS_BAND):
    """Prepend a band of the shot's own top-row pixels, column by column so any
    horizontal gradient carries through."""
    out = Image.new("RGB", (shot.width, shot.height + band_h))
    out.paste(shot.crop((0, 0, shot.width, 1)).resize((shot.width, band_h)), (0, 0))
    out.paste(shot, (0, band_h))
    return out


def row_coverage_adaptive(img, y, step=8, inset=10, thr=20):
    """Row 'coverage' for 05-insights' stat-box cards.

    compose.row_coverage compares every sample to a fixed margin pixel; that
    misses this panel's stat boxes, whose fill is only ~35 RGB-sum away from
    the page background - under compose's default thr=45, and easy for the
    default step=8 sampling grid to miss entirely where it lands, since a
    plain fill area (no text passing through that exact row) never registers
    as different at all. Comparing each sample to the row's own darkest pixel
    (the true page background is always the darkest thing in this dark-mode
    UI) catches the card fill itself, not just its text, at any threshold
    that clears normal anti-aliasing noise."""
    px = img.load()
    xs = range(inset, img.width - inset, step)
    vals = [px[x, y] for x in xs]
    base = min(vals, key=lambda c: sum(c))
    hits = sum(1 for c in vals if sum(abs(c[i] - base[i]) for i in range(3)) > thr)
    return hits / len(vals)


def snap_cut_adaptive(img, preferred, tabbar_top, window, thr=20, tol=0.02, run=10):
    """Same walk as compose.snap_cut, via row_coverage_adaptive instead."""
    if row_coverage_adaptive(img, preferred, thr=thr) <= tol:
        return preferred, True
    clear = 0
    for y in range(min(preferred, tabbar_top), max(0, preferred - window), -1):
        if row_coverage_adaptive(img, y, thr=thr) <= tol:
            clear += 1
            if clear >= run:
                return y + clear - 1, True
        else:
            clear = 0
    return preferred, False


def cut_for(path, key):
    if key not in SNAP_PANELS:
        return CROP_BOTTOM[key]
    preferred = CROP_BOTTOM[key]
    with Image.open(path) as im:
        cut, ok = snap_cut_adaptive(im.convert("RGB"), preferred, TABBAR_TOP, window=SNAP_WINDOW)
    if not ok:
        print(f"  WARN {key}: no clean cut in this capture; kept {cut}. "
              f"The last card is bisected - re-capture with a different scroll.")
    elif cut != preferred:
        print(f"  cut {key}: {preferred} -> {cut} (snapped clear of a card)")
    return cut


def load_shot(raw_dir, key):
    if key == "02-bodymap":
        single = os.path.join(raw_dir, "02-bodymap.png")
        cb = cut_for(single, key) if os.path.exists(single) else CROP_BOTTOM[key]
        shot = bodymap_shot(raw_dir, STATUS_CROP, cb, 0, 0)
    else:
        path = os.path.join(raw_dir, f"{key}.png")
        if not os.path.exists(path):
            return None
        bottom = cut_for(path, key)
        if key in EXCEPTION_PANELS:
            # These two screens have no tab bar of their own to anchor on, so
            # crop_top is re-derived from this canvas's fixed content height
            # instead, keeping the composer/footer fully framed.
            top = max(0, bottom - CONTENT_H)
        else:
            top = STATUS_CROP
        shot = load_cropped_shot(path, top, bottom)
    if shot is None:
        return None
    shot = with_status_band(shot)
    if key in PAD_PANELS:
        shot = pad_to_height(shot, CONTENT_H + STATUS_BAND)
    return shot


def build_all(lang):
    raw_dir = os.path.join(RAW_BASE, lang)
    if not os.path.isdir(raw_dir):
        print(f"SKIP {lang}: no raw dir {raw_dir}")
        return []
    out_dir = os.path.join(OUT_BASE, lang)
    os.makedirs(out_dir, exist_ok=True)
    written = []
    for key in PANELS_2_0_0:
        shot = load_shot(raw_dir, key)
        if shot is None:
            print(f"SKIP {lang}/{key}: raw capture missing")
            continue
        headline, sub, chips = chips_for(lang, key, platform="android")
        cfg = dict(BASE, headline=headline, sub=sub, lang=lang, align=align_for(lang))
        written.append(frame(out_dir, key, cfg, chips, shot))
    return written


def main(argv):
    langs = argv[1:] or list(LANGS)
    if langs == ["all"]:
        langs = list(LANGS)
    written = []
    for lang in langs:
        print(f"--- {lang} ---")
        written += build_all(lang)
    bad = [p for p in written if not verify_output(p, CANVAS)]
    print(f"\n{len(written)} file(s), canvas {CANVAS[0]}x{CANVAS[1]} RGB: "
          f"{len(written) - len(bad)} OK, {len(bad)} FAIL")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
