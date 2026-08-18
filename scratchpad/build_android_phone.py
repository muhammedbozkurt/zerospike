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
    new_canvas_with_header, draw_device, draw_chip_at, load_cropped_shot, font, F_BOLD,
    measure_chip, bodymap_shot, fit_header_and_chip, verify_output, align_for,
)
from i18n_copy import FRAME_COPY, CHIP_EMOJI, LANGS, PANELS_2_0_0
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


def dev_w_for_content(shot_img, dev_y=DEV_Y, dev_w_cap=DEV_W_STD):
    cw, ch = shot_img.size
    budget_h = SAFE_BOTTOM - dev_y
    inner_h_max = budget_h - 2 * BEZEL
    inner_w_needed = inner_h_max * cw / ch
    dev_w = int(inner_w_needed + 2 * BEZEL)
    return max(250, min(dev_w_cap, dev_w))


def add_punch_hole(canvas, dev_x, dev_y, dev_w):
    d = ImageDraw.Draw(canvas)
    cx = dev_x + dev_w // 2
    cy = dev_y + BEZEL + 24
    r = 9
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(3, 3, 4))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(40, 40, 44), width=1)


def place_device_and_chips(cfg, shot_img, chips, dev_w=None):
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    f_chip = font(F_BOLD, cfg["chip_size"], lang=cfg.get("lang"))
    chip_h = max([measure_chip(probe, c["text"], f_chip, c.get("emoji"))[1] for c in chips] or [0])
    total_h = len(chips) * chip_h + (len(chips) - 1) * 14
    sub_lines, cy, fits = fit_header_and_chip(cfg, total_h, DEV_Y, 18, 6)
    if not fits:
        print(f"  WARN [{cfg.get('lang')}] chip overlaps the header band")
    cfg = dict(cfg, sub_max_lines=sub_lines)

    canvas, draw, y_after = new_canvas_with_header(cfg)
    if dev_w is None:
        dev_w = DEV_W_STD
    dev_x = (CANVAS[0] - dev_w) // 2
    dev_box = draw_device(canvas, shot_img, dev_x, DEV_Y, dev_w, BEZEL, RADIUS)
    add_punch_hole(canvas, dev_x, DEV_Y, dev_w)
    for ch in chips:
        w, h, *_ = measure_chip(draw, ch["text"], f_chip, ch.get("emoji"))
        if cfg.get("align") == "center":
            x = (CANVAS[0] - w) // 2
        else:
            x = CANVAS[0] - cfg["margin_x"] - w
        draw_chip_at(canvas, ch["text"], x, cy, f_chip, emoji_ch=ch.get("emoji"), dot=ch.get("dot"))
        cy += h + 14
    return canvas, dev_box


def frame(out_dir, key, cfg, chips, shot, dev_w=None):
    if dev_w is None:
        dev_w = dev_w_for_content(shot)
    canvas, dev_box = place_device_and_chips(cfg, shot, chips, dev_w=dev_w)
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
        shot = load_cropped_shot(path, STATUS_CROP, iphone.cut_for(path, key))
    return with_status_band(shot) if shot is not None else None


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
    copy = FRAME_COPY[lang]
    written = []
    for key in PANELS_2_0_0:
        shot = load_shot(raw_dir_for(lang, key), key)
        if shot is None:
            print(f"SKIP {lang}/{key}: raw capture missing")
            continue
        headline, sub, chip_text = copy[key]
        cfg = dict(BASE, headline=headline, sub=sub, lang=lang, align=align_for(lang))
        written.append(frame(out_dir, key, cfg, [{"text": chip_text, "emoji": CHIP_EMOJI[key]}], shot))
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
