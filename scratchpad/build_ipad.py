#!/usr/bin/env python3
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from compose import (
    new_canvas_with_header, draw_device, draw_chip_at, load_cropped_shot, font, F_BOLD,
    measure_chip,
)
from i18n_copy import FRAME_COPY, CHIP_EMOJI

RAW_BASE = "/Users/muhammedbozkurt/Desktop/Others/zerospike/raw/ipad"
OUT_BASE = "/Users/muhammedbozkurt/Desktop/Others/zerospike/zerospike-store-r93/ipad-2064x2752"

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

CROP_BOTTOM = {"01-ring": 2575, "02-bodymap": 2120, "04-food": 2340, "05-insights": 2705, "07-spike": 2345}


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
    cy = y_after + int(26 * S)
    for ch in chips:
        w, h, *_ = measure_chip(draw, ch["text"], f_chip, ch.get("emoji"))
        x = CANVAS[0] - cfg["margin_x"] - w
        if cy + h > DEV_Y - int(8 * S):
            break
        draw_chip_at(canvas, ch["text"], x, cy, f_chip, emoji_ch=ch.get("emoji"), dot=ch.get("dot"))
        cy += h + int(20 * S)
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


def build_all(lang):
    raw_dir = os.path.join(RAW_BASE, lang)
    out_dir = os.path.join(OUT_BASE, lang)
    os.makedirs(out_dir, exist_ok=True)
    copy = FRAME_COPY[lang]
    for key in ["01-ring", "02-bodymap", "04-food", "05-insights", "07-spike"]:
        headline, sub, chip_text = copy[key]
        frame(out_dir, key, headline, sub, [{"text": chip_text, "emoji": CHIP_EMOJI[key]}],
              os.path.join(raw_dir, f"{key}.png"), crop_bottom=CROP_BOTTOM[key])


if __name__ == "__main__":
    lang = sys.argv[1] if len(sys.argv) > 1 else "tr"
    build_all(lang)
