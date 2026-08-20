#!/usr/bin/env python3
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image
from compose import (
    new_canvas_with_header, draw_device, load_cropped_shot, font, F_BOLD,
    measure_chip, fit_header_and_chip, verify_output, snap_cut, align_for,
    layout_chips, draw_chips,
)
from i18n_copy import LANGS, PANELS_2_0_0 as _ALL_PANELS, chips_for

# Lets a single panel be re-rendered on its own (env var, comma-separated
# panel keys) without touching the other 6 - needed once 09-reminders gets
# a fresh raw capture pass (permission banner hidden, list seeded fuller)
# and only it needs to be rebuilt across all 9 languages.
import os as _os
_filter = _os.environ.get("PANEL_FILTER")
PANELS_2_0_0 = tuple(p for p in _ALL_PANELS if p in _filter.split(",")) if _filter else _ALL_PANELS

RAW_BASE = "/Users/muhammedbozkurt/Desktop/Others/zerospike/raw/ipad"
OUT_BASE = "/Users/muhammedbozkurt/Desktop/Others/zerospike/zerospike-store/ipad-2064x2752"

CANVAS = (2064, 2752)
S = 2064 / 1284.0
BASE = dict(
    canvas=CANVAS, margin_x=int(64 * S), headline_top=int(64 * S), headline_size=int(84 * S),
    sub_size=int(36 * S), chip_size=int(32 * S), text_w=int(CANVAS[0] * 0.80),
)
DEV_Y = int(460 * S)
DEV_W_STD = CANVAS[0] - 2 * BASE["margin_x"]
BEZEL = int(16 * S)
RADIUS = int(64 * S)
SAFE_BOTTOM = CANVAS[1] - int(24 * S)

# --- fixed device frame -----------------------------------------------------
# Same fixed-rect approach as build_iphone.py: dev_x/dev_y/dev_w are already
# canvas-wide constants, and TARGET_CROP_H makes every shot's height a
# canvas-wide constant too, so draw_device's own aspect-ratio math produces an
# identical dev_h for all 7 panels x 9 languages. See build_iphone's longer
# comment for the general reasoning; iPad's own per-panel picture, verified
# against raw/ipad/*/<panel>.png:
#   - 01-ring: its own long-standing anchor (floating "+ kayit ekle" button's
#     bottom edge), reused unchanged as TARGET_CROP_H.
#   - 02-bodymap, 04-food, 09-reminders: extended with real pixels (2290,
#     2490 and 1500 respectively -> 2586); confirmed blank the whole way in
#     every language, no padding needed (iPad's map card, food grid and
#     reminders screen all have more headroom before their tab bar than the
#     iPhone captures do).
#   - 05-insights, 07-spike: trimmed by a handful of px (2595->2586,
#     2590->2586); both land inside the same clean gap their own anchor
#     already used, well before the next card/section.
#   - 08-takip: EXCEPTION, same reasoning as iPhone - the onboarding footer
#     sits deeper than 2586 allows from crop_top=0, so crop_top shifts down
#     instead (loses the back-chevron/language-pill row's very top sliver,
#     keeps the progress bar and question text fully framed).
TARGET_CROP_H = 2586

# Measured on the 2026-08-18 iPad captures (2064x2752); the app tab bar's top
# border is at y=2604.
TABBAR_TOP = 2604
CROP_BOTTOM = {
    "01-ring": TARGET_CROP_H,      # bottom edge of the floating "+ kayit ekle" button
    "02-bodymap": TARGET_CROP_H,   # extended into the map card's own blank interior
    "04-food": TARGET_CROP_H,      # extended past the last category tile row (still before the tab bar)
    "05-insights": TARGET_CROP_H,  # was 2595; trimmed 9px, still before the next section head
    "07-spike": TARGET_CROP_H,     # was 2590; trimmed 4px, still in the same clean gap
    # onboarding question screen: in the empty band between the pinned footer
    # (Continue + the skip link, which end ~2650) and the home indicator (~2726).
    # Snapped per capture, so a longer footer just pulls the cut up. EXCEPTION,
    # see load_shot.
    "08-takip": 2690,
    # Settings > Reminders: no tab bar, content (hint + 3 rows + add row) sits
    # near the top with a lot of empty space under it - confirmed blank for
    # every language from y=1500 to well past TARGET_CROP_H.
    "09-reminders": TARGET_CROP_H,
}
SNAP_PANELS = {"08-takip"}
# see build_iphone.SNAP_START - onboarding has no tab bar to bound the walk with
SNAP_START = {"08-takip": None}
SNAP_WINDOW = 340
# 08-takip's must-stay-visible element (onboarding footer) sits deeper than
# TARGET_CROP_H allows from crop_top=0 and has no tab bar to bound a bottom
# trim, so crop_top shifts down instead - see build_iphone.EXCEPTION_PANELS.
EXCEPTION_PANELS = {"08-takip"}

# See build_iphone.CHIP_DEV_GAP - same fixed minimum, scaled by S. Rounded
# (not the plain int() truncation every other constant in this file uses),
# because this one is a MINIMUM requirement - truncating 24*S down to 38
# would under-deliver the 39px an exact 1284->2064 scale-up implies.
CHIP_DEV_GAP = round(24 * S)


def cut_for(path, key):
    if key not in SNAP_PANELS:
        return CROP_BOTTOM[key]
    preferred = CROP_BOTTOM[key]
    start = SNAP_START.get(key, TABBAR_TOP)
    if start is None:
        start = preferred
    with Image.open(path) as im:
        cut, ok = snap_cut(im.convert("RGB"), preferred, start, window=SNAP_WINDOW)
    if not ok:
        print(f"  WARN {key}: no clean cut in this capture; kept {cut}. "
              f"The last card is bisected - re-capture with a different scroll.")
    elif cut != preferred:
        print(f"  cut {key}: {preferred} -> {cut} (snapped clear of a card)")
    return cut


def load_shot(raw_path, key):
    bottom = cut_for(raw_path, key)
    if key in EXCEPTION_PANELS:
        top = max(0, bottom - TARGET_CROP_H)
        return load_cropped_shot(raw_path, top, bottom)
    return load_cropped_shot(raw_path, 0, bottom)


def place_device_and_chips(cfg, shot_img, chips):
    from PIL import ImageDraw, Image as _Image
    probe = ImageDraw.Draw(_Image.new("RGB", (8, 8)))
    f_chip = font(F_BOLD, cfg["chip_size"], lang=cfg.get("lang"))
    available_w = CANVAS[0] - 2 * cfg["margin_x"]
    orientation, block_w, block_h, boxes = layout_chips(probe, chips, f_chip, available_w, gap_y=int(20 * S))
    sub_lines, cy, fits = fit_header_and_chip(cfg, block_h, DEV_Y, int(26 * S), CHIP_DEV_GAP)
    if not fits:
        print(f"  WARN [{cfg.get('lang')}] chip overlaps the header band")
    cfg = dict(cfg, sub_max_lines=sub_lines)

    canvas, draw, y_after = new_canvas_with_header(cfg)
    dev_w = DEV_W_STD
    dev_x = (CANVAS[0] - dev_w) // 2
    dev_box = draw_device(canvas, shot_img, dev_x, DEV_Y, dev_w, BEZEL, RADIUS)
    draw_chips(canvas, draw, chips, cfg, f_chip, cy, orientation, boxes, gap_y=int(20 * S))
    return canvas, dev_box


def frame(out_dir, key, cfg, chips, shot):
    canvas, dev_box = place_device_and_chips(cfg, shot, chips)
    out_path = os.path.join(out_dir, f"{key}.png")
    canvas.save(out_path)
    print("wrote", out_path, canvas.size, "dev_box", dev_box, "content", shot.size)
    return out_path


def build_all(lang):
    raw_dir = os.path.join(RAW_BASE, lang)
    out_dir = os.path.join(OUT_BASE, lang)
    if not os.path.isdir(raw_dir):
        print(f"SKIP {lang}: no raw dir {raw_dir}")
        return []
    os.makedirs(out_dir, exist_ok=True)
    written = []
    for key in PANELS_2_0_0:
        raw_path = os.path.join(raw_dir, f"{key}.png")
        if not os.path.exists(raw_path):
            print(f"SKIP {lang}/{key}: raw capture missing")
            continue
        headline, sub, chips = chips_for(lang, key)
        cfg = dict(BASE, headline=headline, sub=sub, lang=lang, align=align_for(lang))
        shot = load_shot(raw_path, key)
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
