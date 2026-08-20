#!/usr/bin/env python3
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image
from compose import (
    new_canvas_with_header, draw_device, load_cropped_shot, font, F_BOLD,
    measure_chip, bodymap_shot, fit_header_and_chip, verify_output, snap_cut, align_for,
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

# --- fixed device frame -----------------------------------------------------
# The store listing shows all 7 panels side by side, so the phone mockup must
# be the exact same rectangle in every one of them - varying it (the old
# dev_w_for_content path, one width per panel because it back-solved width
# from each panel's own content aspect ratio) reads as sloppy. dev_x/dev_y/
# dev_w are already canvas-wide constants; TARGET_CROP_H makes the shot HEIGHT
# a canvas-wide constant too; draw_device derives dev_h from the shot's own
# aspect ratio at a fixed width, so once every shot handed to it is exactly
# TARGET_CROP_H tall, dev_h falls out identical across every panel and
# language for free.
#
# 2588 is 01-ring's own long-standing anchor (the floating "+ kayit ekle"
# button's bottom edge, itself already language-invariant - the button's
# position doesn't move with translated text length). Reusing it means
# 01-ring needs no change at all; every other standard panel is fitted to it:
#   - 02-bodymap: real safe crop stays 2560 (unchanged) and is padded up to
#     2588, same as 04-food/05-insights below - NOT extended with real
#     pixels. row_coverage reads the 2560-2588 band as "not clean" in every
#     language, which looked like a false positive at first (a full-bleed
#     dark card, so its inset=10 reference pixel sits on the card's own
#     rounded-corner shading rather than page background) and eyeballing
#     tr/fr/de/ar/ja at a coarse x-sampling stride did look like a plain
#     card interior. A closer per-language sweep proved row_coverage right:
#     the ar capture has a "اضغط على الجسم لاختيار منطقة" (tap the body to
#     pick a zone) hint sitting at y=2580-2618, inside that band and absent
#     from every other language's capture - a capture-time UI-state
#     difference, not a text-length one, so no fixed cutoff below 2618
#     would have been safe either without re-verifying it doesn't move.
#     2560 was the pre-existing, already-safe anchor; padding the last 28px
#     avoids the whole question.
#   - 04-food, 05-insights: their own safe (card-free) crop is shorter than
#     2588 in at least one language (04-food would otherwise clip the
#     "KATEGORILER" section head; 05-insights' last bullet card ends
#     anywhere from y=2281 to y=2377 depending on language). Padded up to
#     2588 with their own trailing background color instead - see PAD_PANELS.
#   - 09-reminders: extended 1560->2588 with real pixels; confirmed blank the
#     whole way for every language (this settings screen has no tab bar and
#     its content sits near the top, see the CROP_BOTTOM comment below).
#   - 07-spike, 08-takip: no tab bar, and their must-stay-visible element
#     (chat composer / onboarding footer) sits deeper than 2588 would allow
#     from crop_top=0. These two shift crop_top down instead of trimming
#     crop_bottom, so the composer/footer stays fully framed and only the
#     very top of the screen (status bar, and for 07-spike the chat header's
#     rounded top corner) is sacrificed. See EXCEPTION_PANELS.
TARGET_CROP_H = 2588

# Measured on the 2026-08-18 captures (1320x2868).
TABBAR_TOP = 2619
CROP_BOTTOM = {
    "01-ring": TARGET_CROP_H,   # bottom edge of the floating "+ kayit ekle" button
    "02-bodymap": 2560,   # below the map caption, before the next section head; padded up to TARGET_CROP_H (see above)
    "04-food": 2500,      # below the last food chip, before the KATEGORILER head; padded up to TARGET_CROP_H
    "05-insights": 2602,  # preferred; SNAP walks per-language (2281-2377); padded up to TARGET_CROP_H
    "07-spike": 2790,     # below the chat composer - EXCEPTION, see load_shot
    # onboarding question screen: in the empty band between the pinned footer
    # (Continue + the skip link, which end ~2676) and the iOS home indicator
    # (~2829). Snapped per capture, so a longer footer just pulls the cut up.
    # EXCEPTION, see load_shot.
    "08-takip": 2760,
    # Settings > Reminders: no tab bar (a pushed stack screen, same as
    # onboarding above); content is a hint line, 3 short rows (glucose/med/
    # basal) and the dashed "add" row, all near the top, with the rest of the
    # screen empty in every language (verified against raw/iphone/*/09-
    # reminders.png, y=1560..2588: blank for all 9 languages) - extended to
    # TARGET_CROP_H with real pixels.
    "09-reminders": TARGET_CROP_H,
}
# Panels whose last element moves with copy length (a card list, or onboarding's
# pinned footer), so the cut row has to be found per capture. The rest cut at a
# fixed anchor on purpose: 01-ring at the floating "+ kayit ekle" button's bottom
# edge (it hovers over the list, so no gap ever opens under it), and
# 02-bodymap/07-spike just under the full-width map card and chat composer.
SNAP_PANELS = {"04-food", "05-insights", "08-takip"}
# Upper bound on where the snap walk may START, per panel. Default is the app tab
# bar's top border; onboarding has NO tab bar (a pushed stack screen, edge to
# edge under the home indicator), so it bounds the walk with its own preferred
# row instead.
SNAP_START = {"08-takip": None}
# far enough up to clear the whole trailing card when it overflows the screen;
# for onboarding, far enough to drop the whole footer (button + skip link) when
# the preferred row lands inside it - the button is never cut in half
SNAP_WINDOW = 340
# legacy two-shot bodymap fallback (only older raw sets still have top/bottom)
BODYMAP_TOP_CROP = 2450
BODYMAP_CARD_HEIGHT = 525

# Panels whose own card-free crop is shorter than TARGET_CROP_H in at least
# one language; the shortfall is padded with the shot's own trailing
# background color (compose.pad_to_height) rather than shown as more content,
# which would risk cutting into the next card.
PAD_PANELS = {"02-bodymap", "04-food", "05-insights"}
# Panels with a must-stay-visible element anchored to the BOTTOM (chat
# composer / onboarding footer) and no tab bar to bound a bottom trim, so
# crop_top shifts down instead of crop_bottom shifting up. Keeps the frame
# fixed without ever cutting the composer/footer.
EXCEPTION_PANELS = {"07-spike", "08-takip"}

# Measured minimum gap between the chip block's bottom edge and the device
# frame's top edge (dev_y) - fit_header_and_chip's `pad` arg IS this gap (the
# ceiling it solves for is dev_y - pad - chip_h), so raising it here is the
# whole fix. 24px is the iPhone-canvas baseline; the other builds scale it by
# their own canvas width relative to this one (1284px).
CHIP_DEV_GAP = 24


def place_device_and_chips(cfg, shot_img, chips):
    from PIL import ImageDraw, Image as _Image
    probe = ImageDraw.Draw(_Image.new("RGB", (8, 8)))
    f_chip = font(F_BOLD, cfg["chip_size"], lang=cfg.get("lang"))
    available_w = CANVAS[0] - 2 * cfg["margin_x"]
    orientation, block_w, block_h, boxes = layout_chips(probe, chips, f_chip, available_w, gap_y=20)
    sub_lines, cy, fits = fit_header_and_chip(cfg, block_h, DEV_Y, 26, CHIP_DEV_GAP)
    if not fits:
        print(f"  WARN [{cfg.get('lang')}] chip overlaps the header band")
    cfg = dict(cfg, sub_max_lines=sub_lines)

    canvas, draw, y_after = new_canvas_with_header(cfg)
    dev_w = DEV_W_STD
    dev_x = (CANVAS[0] - dev_w) // 2
    dev_box = draw_device(canvas, shot_img, dev_x, DEV_Y, dev_w, BEZEL, RADIUS)
    draw_chips(canvas, draw, chips, cfg, f_chip, cy, orientation, boxes, gap_y=20)
    return canvas, dev_box


def frame(out_dir, key, cfg, chips, shot):
    canvas, dev_box = place_device_and_chips(cfg, shot, chips)
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
        shot = bodymap_shot(raw_dir, 0, cb, BODYMAP_TOP_CROP, BODYMAP_CARD_HEIGHT)
        if shot is not None and key in PAD_PANELS:
            shot = pad_to_height(shot, TARGET_CROP_H)
        return shot
    path = os.path.join(raw_dir, f"{key}.png")
    if not os.path.exists(path):
        return None
    bottom = cut_for(path, key)
    if key in EXCEPTION_PANELS:
        top = max(0, bottom - TARGET_CROP_H)
        return load_cropped_shot(path, top, bottom)
    shot = load_cropped_shot(path, 0, bottom)
    if key in PAD_PANELS:
        shot = pad_to_height(shot, TARGET_CROP_H)
    return shot


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
