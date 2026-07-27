#!/usr/bin/env python3
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image
from compose import (
    new_canvas_with_header, draw_device, draw_chip_at, load_cropped_shot, font, F_BOLD,
    measure_chip,
)
from i18n_copy import FRAME_COPY, CHIP_EMOJI

RAW_BASE = "/Users/muhammedbozkurt/Desktop/Others/zerospike/raw/iphone"
OUT_BASE = "/Users/muhammedbozkurt/Desktop/Others/zerospike/zerospike-store-r93/iphone-1284x2778"

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

# crop points are layout-driven (device/content geometry), not language-driven -
# reused across all 5 languages; verified on TR, spot-check others before bulk use.
CROP_BOTTOM = {"01-ring": 2588, "04-food": 2542, "05-insights": 2618, "07-spike": 2790}
BODYMAP_TOP_CROP = 2450
BODYMAP_CARD_HEIGHT = 525  # rotation card crop height, incl. small top/bottom margin (see find_card_top)


def dev_w_for_content(shot_img, dev_y=DEV_Y, dev_w_cap=DEV_W_STD):
    cw, ch = shot_img.size
    budget_h = SAFE_BOTTOM - dev_y
    inner_h_max = budget_h - 2 * BEZEL
    inner_w_needed = inner_h_max * cw / ch
    dev_w = int(inner_w_needed + 2 * BEZEL)
    return max(300, min(dev_w_cap, dev_w))


def place_device_and_chips(cfg, shot_img, chips, dev_w=None):
    canvas, draw, y_after = new_canvas_with_header(cfg)
    if dev_w is None:
        dev_w = DEV_W_STD
    dev_x = (CANVAS[0] - dev_w) // 2
    dev_box = draw_device(canvas, shot_img, dev_x, DEV_Y, dev_w, BEZEL, RADIUS)
    f_chip = font(F_BOLD, cfg["chip_size"])
    cy = y_after + 26
    for ch in chips:
        w, h, *_ = measure_chip(draw, ch["text"], f_chip, ch.get("emoji"))
        x = CANVAS[0] - cfg["margin_x"] - w
        if cy + h > DEV_Y - 8:
            break
        draw_chip_at(canvas, ch["text"], x, cy, f_chip, emoji_ch=ch.get("emoji"), dot=ch.get("dot"))
        cy += h + 20
    return canvas, dev_box


def frame(out_dir, key, headline, sub, chips, shot_path, crop_top=0, crop_bottom=None, dev_w=None):
    cfg = dict(BASE, headline=headline, sub=sub)
    shot = load_cropped_shot(shot_path, crop_top, crop_bottom)
    if dev_w is None:
        dev_w = dev_w_for_content(shot)
    canvas, dev_box = place_device_and_chips(cfg, shot, chips, dev_w=dev_w)
    out_path = os.path.join(out_dir, f"{key}.png")
    canvas.save(out_path)
    print("wrote", out_path, canvas.size, "dev_box", dev_box, "content", shot.size)


def find_card_top(bottom_img, x=60, scan_from=1200, scan_to=2400, gap=30):
    """The rotation-card scroll depth isn't perfectly reproducible run to run
    (same drag can land at a different offset each time), so a fixed pixel
    crop either duplicates content already shown in the top half or leaves a
    gap. The background here is a soft gradient (drifts gradually with y), so
    comparing each row against a LOCAL row `gap` px above it - rather than one
    fixed reference - tells apart the card's real border (a sharp jump) from
    that slow drift, and from thin one-off highlight lines (which fall back to
    background within a few rows instead of staying elevated)."""
    px = bottom_img.load()
    for y in range(scan_from, scan_to):
        c, ref = px[x, y], px[x, y - gap]
        if abs(c[0] - ref[0]) + abs(c[1] - ref[1]) + abs(c[2] - ref[2]) > 15:
            c2 = px[x, y + 60]
            if abs(c2[0] - ref[0]) + abs(c2[1] - ref[1]) + abs(c2[2] - ref[2]) > 10:
                return y
    return scan_from


def stitched_bodymap(raw_dir):
    top = load_cropped_shot(os.path.join(raw_dir, "02-bodymap-top.png"), 0, BODYMAP_TOP_CROP)
    bottom_full = Image.open(os.path.join(raw_dir, "02-bodymap-bottom.png")).convert("RGB")
    card_top = find_card_top(bottom_full) - 28
    card = bottom_full.crop((0, card_top, bottom_full.size[0], card_top + BODYMAP_CARD_HEIGHT))
    w = top.size[0]
    stitched = Image.new("RGB", (w, top.size[1] + card.size[1]), (8, 14, 20))
    stitched.paste(top, (0, 0))
    stitched.paste(card, (0, top.size[1]))
    return stitched


def build_all(lang):
    raw_dir = os.path.join(RAW_BASE, lang)
    out_dir = os.path.join(OUT_BASE, lang)
    os.makedirs(out_dir, exist_ok=True)
    copy = FRAME_COPY[lang]

    for key in ["01-ring", "04-food", "05-insights", "07-spike"]:
        headline, sub, chip_text = copy[key]
        frame(out_dir, key, headline, sub, [{"text": chip_text, "emoji": CHIP_EMOJI[key]}],
              os.path.join(raw_dir, f"{key}.png"), crop_bottom=CROP_BOTTOM[key])

    headline, sub, chip_text = copy["02-bodymap"]
    cfg2 = dict(BASE, headline=headline, sub=sub)
    shot2 = stitched_bodymap(raw_dir)
    dw2 = dev_w_for_content(shot2)
    canvas2, box2 = place_device_and_chips(cfg2, shot2, [{"text": chip_text, "emoji": CHIP_EMOJI["02-bodymap"]}], dev_w=dw2)
    canvas2.save(os.path.join(out_dir, "02-bodymap.png"))
    print("wrote 02-bodymap", canvas2.size, "dev_box", box2, "content", shot2.size)


if __name__ == "__main__":
    lang = sys.argv[1] if len(sys.argv) > 1 else "tr"
    build_all(lang)
