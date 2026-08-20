#!/usr/bin/env python3
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image
from compose import (
    new_canvas_with_header, draw_device, draw_chip_at, load_cropped_shot, font, F_BOLD,
    measure_chip, fit_header_and_chip, verify_output, snap_cut, align_for,
)
from i18n_copy import LANGS, PANELS_2_0_0, chips_for

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

# Measured on the 2026-08-18 iPad captures (2064x2752); the app tab bar's top
# border is at y=2604. See build_iphone for why the card-list panels are snapped
# per capture instead of pinned to a constant.
TABBAR_TOP = 2604
CROP_BOTTOM = {
    "01-ring": 2586,      # bottom edge of the floating "+ kayit ekle" button
    "02-bodymap": 2290,   # below the rotation card (silhouette + card both whole)
    "04-food": 2490,      # below the last category tile row
    "05-insights": 2595,  # below the "en cok kullanilan bolge" card
    "07-spike": 2590,     # below the sidebar card that sits under the chat sheet
    # onboarding question screen: in the empty band between the pinned footer
    # (Continue + the skip link, which end ~2650) and the home indicator (~2726).
    # Snapped per capture, so a longer footer just pulls the cut up.
    "08-takip": 2690,
    # Settings > Reminders: no tab bar, content (hint + 3 rows + add row) sits
    # near the top with a lot of empty space under it. ESTIMATE, scaled from
    # build_iphone's own 1560/2868 guess by this file's raw height (2752) - see
    # build_iphone.CROP_BOTTOM["09-reminders"] for the full reasoning and the
    # note to re-tighten once a real capture exists.
    "09-reminders": 1500,
}
SNAP_PANELS = {"04-food", "05-insights", "08-takip", "09-reminders"}
# see build_iphone.SNAP_START - onboarding and the reminders settings screen
# have no tab bar to bound the walk with
SNAP_START = {"08-takip": None, "09-reminders": None}
SNAP_WINDOW = 340


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


def dev_w_for_content(shot_img, dev_y=DEV_Y, dev_w_cap=DEV_W_STD):
    cw, ch = shot_img.size
    budget_h = SAFE_BOTTOM - dev_y
    inner_h_max = budget_h - 2 * BEZEL
    inner_w_needed = inner_h_max * cw / ch
    dev_w = int(inner_w_needed + 2 * BEZEL)
    return max(300, min(dev_w_cap, dev_w))


def place_device_and_chips(cfg, shot_img, chips, dev_w=None):
    from PIL import ImageDraw, Image as _Image
    probe = ImageDraw.Draw(_Image.new("RGB", (8, 8)))
    f_chip = font(F_BOLD, cfg["chip_size"], lang=cfg.get("lang"))
    chip_h = max([measure_chip(probe, c["text"], f_chip, c.get("emoji"))[1] for c in chips] or [0])
    total_h = len(chips) * chip_h + (len(chips) - 1) * int(20 * S)
    sub_lines, cy, fits = fit_header_and_chip(cfg, total_h, DEV_Y, int(26 * S), int(8 * S))
    if not fits:
        print(f"  WARN [{cfg.get('lang')}] chip overlaps the header band")
    cfg = dict(cfg, sub_max_lines=sub_lines)

    canvas, draw, y_after = new_canvas_with_header(cfg)
    if dev_w is None:
        dev_w = DEV_W_STD
    dev_x = (CANVAS[0] - dev_w) // 2
    dev_box = draw_device(canvas, shot_img, dev_x, DEV_Y, dev_w, BEZEL, RADIUS)
    for ch in chips:
        w, h, *_ = measure_chip(draw, ch["text"], f_chip, ch.get("emoji"))
        if cfg.get("align") == "center":
            x = (CANVAS[0] - w) // 2
        else:
            x = CANVAS[0] - cfg["margin_x"] - w
        draw_chip_at(canvas, ch["text"], x, cy, f_chip, emoji_ch=ch.get("emoji"), dot=ch.get("dot"))
        cy += h + int(20 * S)
    return canvas, dev_box


def frame(out_dir, key, cfg, chips, shot, dev_w=None):
    if dev_w is None:
        dev_w = dev_w_for_content(shot)
    canvas, dev_box = place_device_and_chips(cfg, shot, chips, dev_w=dev_w)
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
        shot = load_cropped_shot(raw_path, 0, cut_for(raw_path, key))
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
