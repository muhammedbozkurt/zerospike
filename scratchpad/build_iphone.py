#!/usr/bin/env python3
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image
from compose import (
    new_canvas_with_header, draw_device, draw_chip_at, load_cropped_shot, font, F_BOLD,
    measure_chip, bodymap_shot, fit_header_and_chip, verify_output, snap_cut, align_for,
)
from i18n_copy import LANGS, PANELS_2_0_0, chips_for

RAW_BASE = "/Users/muhammedbozkurt/Desktop/Others/zerospike/raw/iphone"
OUT_BASE = "/Users/muhammedbozkurt/Desktop/Others/zerospike/zerospike-store/iphone-1284x2778"

CANVAS = (1284, 2778)
BASE = dict(
    canvas=CANVAS, margin_x=64, headline_top=64, headline_size=84, sub_size=36,
    chip_size=32, text_w=int(CANVAS[0] * 0.80),
)
DEV_X = 64
DEV_W_STD = CANVAS[0] - 2 * DEV_X
DEV_Y = 460
BEZEL = 16
RADIUS = 64
SAFE_BOTTOM = CANVAS[1] - 24

# Measured on the 2026-08-18 captures (1320x2868). These are the preferred cut;
# snap_cut then walks up to the nearest row no card crosses, because card counts
# shift with copy length and the same row is a clean gap in one language and
# mid-card in another.
TABBAR_TOP = 2619
CROP_BOTTOM = {
    "01-ring": 2588,      # bottom edge of the floating "+ kayit ekle" button
    "02-bodymap": 2560,   # below the map caption, before the next section head
    "04-food": 2500,      # below the last food chip, before the KATEGORILER head
    "05-insights": 2602,  # below the insights bullet card, before the next card
    "07-spike": 2790,     # below the chat composer
    # onboarding question screen: in the empty band between the pinned footer
    # (Continue + the skip link, which end ~2676) and the iOS home indicator
    # (~2829). Snapped per capture, so a longer footer just pulls the cut up.
    "08-takip": 2760,
    # Settings > Reminders: no tab bar (a pushed stack screen, same as
    # onboarding above), and unlike every other panel its content does NOT run
    # down near the bottom - just a hint line, 3 short rows (glucose/med/basal)
    # and the dashed "add" row, all near the top, with the rest of the screen
    # empty. ESTIMATE (no raw capture exists yet - see component heights in
    # components/settingsUi.tsx's Row/SettingsScaffold): header + hint + 3
    # rows + add row lands around y~1350-1450 in this 2868-tall raw capture;
    # 1560 leaves a few hundred px of buffer so a longer DE/FR label wrapping
    # to 2 lines still clears. Snapped per capture like the others - re-tighten
    # this constant once a real capture exists instead of trusting the guess.
    "09-reminders": 1560,
}
# Panels whose last element moves with copy length (a card list, or onboarding's
# pinned footer), so the cut row has to be found per capture. The rest cut at a
# fixed anchor on purpose: 01-ring at the floating "+ kayit ekle" button's bottom
# edge (it hovers over the list, so no gap ever opens under it), and
# 02-bodymap/07-spike just under the full-width map card and chat composer.
SNAP_PANELS = {"04-food", "05-insights", "08-takip", "09-reminders"}
# Upper bound on where the snap walk may START, per panel. Default is the app tab
# bar's top border; onboarding and the reminders settings screen have NO tab bar
# (both are pushed stack screens, edge to edge under the home indicator), so they
# bound the walk with their own preferred row instead.
SNAP_START = {"08-takip": None, "09-reminders": None}
# far enough up to clear the whole trailing card when it overflows the screen;
# for onboarding, far enough to drop the whole footer (button + skip link) when
# the preferred row lands inside it - the button is never cut in half
SNAP_WINDOW = 340
# legacy two-shot bodymap fallback (only older raw sets still have top/bottom)
BODYMAP_TOP_CROP = 2450
BODYMAP_CARD_HEIGHT = 525


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
    total_h = len(chips) * chip_h + (len(chips) - 1) * 20
    sub_lines, cy, fits = fit_header_and_chip(cfg, total_h, DEV_Y, 26, 8)
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
        cy += h + 20
    return canvas, dev_box


def frame(out_dir, key, cfg, chips, shot, dev_w=None):
    if dev_w is None:
        dev_w = dev_w_for_content(shot)
    canvas, dev_box = place_device_and_chips(cfg, shot, chips, dev_w=dev_w)
    out_path = os.path.join(out_dir, f"{key}.png")
    canvas.save(out_path)
    print("wrote", out_path, canvas.size, "dev_box", dev_box, "content", shot.size)
    return out_path


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


def load_shot(raw_dir, key, lang):
    if key == "02-bodymap":
        single = os.path.join(raw_dir, "02-bodymap.png")
        cb = cut_for(single, key) if os.path.exists(single) else CROP_BOTTOM[key]
        return bodymap_shot(raw_dir, 0, cb, BODYMAP_TOP_CROP, BODYMAP_CARD_HEIGHT)
    path = os.path.join(raw_dir, f"{key}.png")
    if not os.path.exists(path):
        return None
    return load_cropped_shot(path, 0, cut_for(path, key))


def build_all(lang):
    raw_dir = os.path.join(RAW_BASE, lang)
    out_dir = os.path.join(OUT_BASE, lang)
    if not os.path.isdir(raw_dir):
        print(f"SKIP {lang}: no raw dir {raw_dir}")
        return []
    os.makedirs(out_dir, exist_ok=True)
    written = []
    for key in PANELS_2_0_0:
        shot = load_shot(raw_dir, key, lang)
        if shot is None:
            # captures for the newer languages are still being written
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
