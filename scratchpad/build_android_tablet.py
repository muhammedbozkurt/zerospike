#!/usr/bin/env python3
"""Android tablet composites (tablet10 + tablet7), derived from the iPad captures.

Same reasoning as build_android_phone: no Android tablet capture pass for
2.0.0, so the iPad raws are reused with their iOS status bar cropped away and
an Android-looking bezel (punch-hole, no island/notch) drawn around them. Both
canvases come from the one raw set."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image, ImageDraw
from compose import (
    new_canvas_with_header, draw_device, load_cropped_shot, font, F_BOLD,
    measure_chip, fit_header_and_chip, verify_output, align_for,
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
import build_ipad as ipad

RAW_BASE = "/Users/muhammedbozkurt/Desktop/Others/zerospike/raw/ipad"
# Android-dressed re-captures of the dashboard panels: the same iPad simulator
# run with ?scPlatform=android, so the iOS-only Apple Health card is out of the
# frame. Only the dashboard panels differ, so only they are re-shot; everything
# else keeps reading the shared iPad raw.
# 08-takip is deliberately NOT here any more: it shoots the onboarding question
# screen now, which carries no iOS-only chrome. Leaving it in would also have
# silently preferred the stale android-src DASHBOARD capture over the new raw.
ANDROID_SRC_BASE = "/Users/muhammedbozkurt/Desktop/Others/zerospike/raw/android-src/ipad"
ANDROID_SRC_PANELS = ("01-ring",)
OUT_ROOT = "/Users/muhammedbozkurt/Desktop/Others/zerospike/zerospike-store"

# In the 2064x2752 iPad raw the status bar glyphs end at y=33 and the app's
# header pill starts at y=50, so 42 sits in the gap. The iPad bar is a thin
# overlay strip, hence a much smaller crop than the phone's 172.
STATUS_CROP = 42
# see build_android_phone.STATUS_BAND - keeps the punch-hole camera off the
# app's own header row
STATUS_BAND = 112

# identical source frames, so the cuts (and their per-capture snapping) come
# straight from the iPad build rather than being kept in sync by hand
CROP_BOTTOM = ipad.CROP_BOTTOM

# --- fixed device frame -----------------------------------------------------
# Same reasoning as build_android_phone.py: the fixed content height for this
# canvas is the iPad build's own TARGET_CROP_H minus STATUS_CROP. Standard
# panels resolve to ipad.TARGET_CROP_H via ipad.cut_for/ipad.CROP_BOTTOM
# already, so cropping STATUS_CROP off their top lands on CONTENT_H for free;
# iPad needed no PAD_PANELS (every standard panel's real content reaches
# ipad.TARGET_CROP_H without padding), so neither does this canvas. 08-takip
# (ipad.EXCEPTION_PANELS) still needs its own crop_top, deeper than iPad's by
# STATUS_CROP, to additionally clear the status bar.
CONTENT_H = ipad.TARGET_CROP_H - STATUS_CROP
EXCEPTION_PANELS = ipad.EXCEPTION_PANELS

# iPhone-baseline (1284px, see build_iphone.CHIP_DEV_GAP) minimum chip-to-
# device gap, scaled by each canvas's own width below.
IPHONE_W = 1284
CHIP_DEV_GAP_BASE = 24

CANVASES = [
    # tablet10: matches the raw capture's own native width exactly
    dict(name="android-tablet10-1600x2560", size=(1600, 2560), dev_y=480, margin_x=70,
         headline_size=76, sub_size=33, chip_size=29, bezel=14, radius=56),
    # tablet7: same raws, scaled-down geometry, different aspect (9:16)
    dict(name="android-tablet7-1080x1920", size=(1080, 1920), dev_y=360, margin_x=48,
         headline_size=58, sub_size=25, chip_size=22, bezel=11, radius=42),
]


def with_status_band(shot, band_h=STATUS_BAND):
    """Prepend a band of the shot's own top-row pixels, column by column so any
    horizontal gradient carries through."""
    out = Image.new("RGB", (shot.width, shot.height + band_h))
    out.paste(shot.crop((0, 0, shot.width, 1)).resize((shot.width, band_h)), (0, 0))
    out.paste(shot, (0, band_h))
    return out


def resolve_sources(lang):
    """Per-panel raw path for this language: the Android-dressed re-shot when one
    exists, otherwise the shared iPad raw (which still carries the Apple Health
    card, hence the warning). Resolved once per language so both canvases build
    from the same decision and the warning is printed once."""
    sources = {}
    for key in PANELS_2_0_0:
        src = os.path.join(ANDROID_SRC_BASE, lang, f"{key}.png")
        if key in ANDROID_SRC_PANELS and os.path.exists(src):
            sources[key] = src
            continue
        if key in ANDROID_SRC_PANELS:
            print(f"  WARN {lang}/{key}: no android-src capture; falling back to "
                  f"the iPad raw - the Apple Health card will be visible in the frame")
        fallback = os.path.join(RAW_BASE, lang, f"{key}.png")
        sources[key] = fallback if os.path.exists(fallback) else None
    return sources


def build_for_canvas(lang, spec, sources, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    W, H = spec["size"]
    margin_x, dev_y, bezel, radius = spec["margin_x"], spec["dev_y"], spec["bezel"], spec["radius"]
    BASE = dict(canvas=spec["size"], margin_x=margin_x, headline_top=margin_x,
                headline_size=spec["headline_size"], sub_size=spec["sub_size"],
                chip_size=spec["chip_size"], text_w=int(W * 0.80))
    dev_w_std = W - 2 * margin_x
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    written = []

    def add_punch_hole(canvas, dev_x, dw):
        d = ImageDraw.Draw(canvas)
        cx = dev_x + dw // 2
        cy = dev_y + bezel + int(bezel * 1.6)
        r = max(6, int(bezel * 0.6))
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(3, 3, 4))

    for key in PANELS_2_0_0:
        raw_path = sources.get(key)
        if raw_path is None:
            print(f"SKIP {lang}/{spec['name']}/{key}: raw capture missing")
            continue
        headline, sub, chips = chips_for(lang, key)
        cfg = dict(BASE, headline=headline, sub=sub, lang=lang, align=align_for(lang))
        f_chip = font(F_BOLD, cfg["chip_size"], lang=lang)
        chip_stack_gap = int(margin_x * 0.35)
        available_w = W - 2 * margin_x
        orientation, block_w, block_h, boxes = layout_chips(probe, chips, f_chip, available_w, gap_y=chip_stack_gap)
        gap = int(margin_x * 0.4)
        chip_dev_gap = round(CHIP_DEV_GAP_BASE * W / IPHONE_W)
        cfg["sub_max_lines"], cy0, fits = fit_header_and_chip(
            cfg, block_h, dev_y, gap, chip_dev_gap)
        if not fits:
            print(f"  WARN [{lang}] chip overlaps the header band")

        bottom = ipad.cut_for(raw_path, key)
        top = max(0, bottom - CONTENT_H) if key in EXCEPTION_PANELS else STATUS_CROP
        shot = with_status_band(load_cropped_shot(raw_path, top, bottom))
        dw = dev_w_std
        dev_x = (W - dw) // 2

        canvas, draw, y_after = new_canvas_with_header(cfg)
        dev_box = draw_device(canvas, shot, dev_x, dev_y, dw, bezel, radius)
        add_punch_hole(canvas, dev_x, dw)
        draw_chips(canvas, draw, chips, cfg, f_chip, cy0, orientation, boxes, gap_y=chip_stack_gap)

        out_path = os.path.join(out_dir, f"{key}.png")
        canvas.save(out_path)
        print("wrote", out_path, canvas.size, "dev_box", dev_box, "content", shot.size)
        written.append((out_path, spec["size"]))
    return written


def build_all(lang):
    raw_dir = os.path.join(RAW_BASE, lang)
    if not os.path.isdir(raw_dir) and not os.path.isdir(os.path.join(ANDROID_SRC_BASE, lang)):
        print(f"SKIP {lang}: no raw dir {raw_dir}")
        return []
    sources = resolve_sources(lang)
    written = []
    for spec in CANVASES:
        written += build_for_canvas(lang, spec, sources, os.path.join(OUT_ROOT, spec["name"], lang))
    return written


def main(argv):
    langs = argv[1:] or list(LANGS)
    if langs == ["all"]:
        langs = list(LANGS)
    written = []
    for lang in langs:
        print(f"--- {lang} ---")
        written += build_all(lang)
    bad = [p for p, size in written if not verify_output(p, size)]
    print(f"\n{len(written)} file(s): {len(written) - len(bad)} OK, {len(bad)} FAIL")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
