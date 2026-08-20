#!/usr/bin/env python3
"""Android phone composites, derived from the iPhone captures.

There is no Android capture pass for 2.0.0, so the iPhone raws are reused with
their iOS status bar cropped away (STATUS_CROP): no clock, no signal stack and
no Dynamic Island survives into the frame, and nothing iOS-specific is drawn
back. The bezel keeps its Android reading via the punch-hole camera."""
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
import build_iphone as iphone

RAW_BASE = "/Users/muhammedbozkurt/Desktop/Others/zerospike/raw/iphone"
# Android-dressed re-captures of the dashboard panels: the same iPhone simulator
# run with ?scPlatform=android, so the iOS-only Apple Health card is out of the
# frame. Only the dashboard panels differ, so only they are re-shot; everything
# else keeps reading the shared iPhone raw.
# 08-takip is deliberately NOT here any more: it shoots the onboarding question
# screen now, which carries no iOS-only chrome. Leaving it in would also have
# silently preferred the stale android-src DASHBOARD capture over the new raw.
ANDROID_SRC_BASE = "/Users/muhammedbozkurt/Desktop/Others/zerospike/raw/android-src/iphone"
ANDROID_SRC_PANELS = ("01-ring",)
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

# In the 1320x2868 iPhone raw the Dynamic Island's black pill ends at y=153 and
# the app's own header starts at y~188, so 172 sits in the gap: the whole iOS
# status bar goes, no app content is clipped.
STATUS_CROP = 172
# The cropped frame would otherwise start flush with the app header, leaving the
# punch-hole camera sitting on top of a button. Re-open a plain strip built from
# the shot's own top row (the app draws edge to edge under a transparent status
# bar, so this is its real background) - no invented clock or battery glyphs.
STATUS_BAND = 104

# identical source frames, so the cuts (and their per-capture snapping) come
# straight from the iPhone build rather than being kept in sync by hand
BODYMAP_TOP_CROP = iphone.BODYMAP_TOP_CROP
BODYMAP_CARD_HEIGHT = iphone.BODYMAP_CARD_HEIGHT
CROP_BOTTOM = iphone.CROP_BOTTOM

# --- fixed device frame -----------------------------------------------------
# Same reasoning as build_iphone/build_ipad: dev_w is now a canvas-wide
# constant (DEV_W_STD, no more dev_w_for_content), and every shot handed to
# draw_device is exactly this canvas's fixed content height, so dev_h falls
# out identical for all 7 panels x 9 languages. The fixed content height here
# is the iPhone build's own TARGET_CROP_H minus STATUS_CROP: standard panels
# (01-ring, 02-bodymap, 09-reminders) already resolve to iphone.TARGET_CROP_H
# via iphone.cut_for/iphone.CROP_BOTTOM, so cropping STATUS_CROP off their top
# lands on this value for free. 04-food/05-insights (iphone.PAD_PANELS) need
# their own padding call here too, since their real safe crop is still
# shorter than target after the status-bar crop. 07-spike/08-takip
# (iphone.EXCEPTION_PANELS) need their own crop_top - the iPhone build's own
# crop_top already sacrifices the top of the screen to protect the composer/
# footer, and Android needs to additionally clear the status bar, so its
# crop_top is deeper than iPhone's by STATUS_CROP.
CONTENT_H = iphone.TARGET_CROP_H - STATUS_CROP
PAD_PANELS = iphone.PAD_PANELS
EXCEPTION_PANELS = iphone.EXCEPTION_PANELS

# See build_iphone.CHIP_DEV_GAP - same fixed minimum, scaled by this canvas's
# own width relative to the iPhone canvas (1284px) it's baselined against.
CHIP_DEV_GAP = round(iphone.CHIP_DEV_GAP * CANVAS[0] / iphone.CANVAS[0])


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


def load_shot(raw_dir, key):
    if key == "02-bodymap":
        single = os.path.join(raw_dir, "02-bodymap.png")
        cb = iphone.cut_for(single, key) if os.path.exists(single) else CROP_BOTTOM[key]
        shot = bodymap_shot(raw_dir, STATUS_CROP, cb, BODYMAP_TOP_CROP, BODYMAP_CARD_HEIGHT)
    else:
        path = os.path.join(raw_dir, f"{key}.png")
        if not os.path.exists(path):
            return None
        bottom = iphone.cut_for(path, key)
        if key in EXCEPTION_PANELS:
            # Android needs to additionally clear the status bar on top of
            # iPhone's own composer/footer-preserving crop_top, so it can't
            # just reuse iPhone's crop_top - re-derive it from this canvas's
            # own fixed content height instead.
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


def raw_dir_for(lang, key):
    """Where this panel's capture comes from: the Android-dressed re-shot when
    one exists, otherwise the shared iPhone raw (which still carries the Apple
    Health card, hence the warning)."""
    fallback = os.path.join(RAW_BASE, lang)
    if key not in ANDROID_SRC_PANELS:
        return fallback
    src_dir = os.path.join(ANDROID_SRC_BASE, lang)
    if os.path.exists(os.path.join(src_dir, f"{key}.png")):
        return src_dir
    print(f"  WARN {lang}/{key}: no android-src capture; falling back to the "
          f"iPhone raw - the Apple Health card will be visible in the frame")
    return fallback


def build_all(lang):
    raw_dir = os.path.join(RAW_BASE, lang)
    out_dir = os.path.join(OUT_BASE, lang)
    if not os.path.isdir(raw_dir) and not os.path.isdir(os.path.join(ANDROID_SRC_BASE, lang)):
        print(f"SKIP {lang}: no raw dir {raw_dir}")
        return []
    os.makedirs(out_dir, exist_ok=True)
    written = []
    for key in PANELS_2_0_0:
        shot = load_shot(raw_dir_for(lang, key), key)
        if shot is None:
            print(f"SKIP {lang}/{key}: raw capture missing")
            continue
        headline, sub, chips = chips_for(lang, key)
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
