#!/usr/bin/env python3
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image, ImageDraw
from compose import (
    new_canvas_with_header, draw_device, draw_chip_at, load_cropped_shot, font, F_BOLD,
    measure_chip,
)

from i18n_copy import FRAME_COPY, CHIP_EMOJI

RAW_BASE = "/Users/muhammedbozkurt/Desktop/Others/zerospike/raw/android-tablet"

CROPS = {
    "01-ring": dict(crop_bottom=2390),
    "02-bodymap": dict(crop_bottom=2165),
    "04-food": dict(crop_bottom=2010),
    "05-insights": dict(crop_bottom=2465),
    "07-spike": dict(crop_bottom=2495),
}


def build_for_canvas(lang, canvas_size, raw_dir, out_dir, dev_y, margin_x, headline_size, sub_size, chip_size, bezel, radius):
    os.makedirs(out_dir, exist_ok=True)
    W, H = canvas_size
    BASE = dict(canvas=canvas_size, margin_x=margin_x, headline_top=margin_x, headline_size=headline_size,
                sub_size=sub_size, chip_size=chip_size, text_w=int(W * 0.80))
    dev_w_std = W - 2 * margin_x
    safe_bottom = H - int(H * 0.008)
    copy = FRAME_COPY[lang]

    def dev_w_for_content(shot_img):
        cw, ch = shot_img.size
        budget_h = safe_bottom - dev_y
        inner_h_max = budget_h - 2 * bezel
        inner_w_needed = inner_h_max * cw / ch
        dw = int(inner_w_needed + 2 * bezel)
        return max(250, min(dev_w_std, dw))

    def add_punch_hole(canvas, dev_x, dy, dw):
        d = ImageDraw.Draw(canvas)
        cx = dev_x + dw // 2
        cy = dy + bezel + int(bezel * 1.6)
        r = max(6, int(bezel * 0.6))
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(3, 3, 4))

    for key, crop in CROPS.items():
        headline, sub, chip_text = copy[key]
        chips = [{"text": chip_text, "emoji": CHIP_EMOJI[key]}]
        cfg = dict(BASE, headline=headline, sub=sub)
        raw_path = os.path.join(raw_dir, f"{key}.png")
        shot = load_cropped_shot(raw_path, crop.get("crop_top", 0), crop.get("crop_bottom"))
        dw = dev_w_for_content(shot)
        dev_x = (W - dw) // 2

        canvas, draw, y_after = new_canvas_with_header(cfg)
        draw_device(canvas, shot, dev_x, dev_y, dw, bezel, radius)
        add_punch_hole(canvas, dev_x, dev_y, dw)

        f_chip = font(F_BOLD, cfg["chip_size"])
        cy = y_after + int(margin_x * 0.4)
        for ch in chips:
            w, h, *_ = measure_chip(draw, ch["text"], f_chip, ch.get("emoji"))
            x = W - cfg["margin_x"] - w
            if cy + h > dev_y - int(margin_x * 0.15):
                break
            draw_chip_at(canvas, ch["text"], x, cy, f_chip, emoji_ch=ch.get("emoji"), dot=ch.get("dot"))
            cy += h + int(margin_x * 0.35)

        out_path = os.path.join(out_dir, f"{key}.png")
        canvas.save(out_path)
        print("wrote", out_path, canvas.size, "dev_w", dw, "content", shot.size)


def build_all(lang):
    raw_dir = os.path.join(RAW_BASE, lang)
    # tablet10: 1600x2560 - matches the raw capture's own native width exactly
    build_for_canvas(
        lang, (1600, 2560), raw_dir,
        f"/Users/muhammedbozkurt/Desktop/Others/zerospike/zerospike-store-r93/android-tablet10/{lang}",
        dev_y=480, margin_x=70, headline_size=76, sub_size=33, chip_size=29, bezel=14, radius=56,
    )
    # tablet7: 1080x1920 - same raw captures, scaled-down geometry, different aspect (9:16)
    build_for_canvas(
        lang, (1080, 1920), raw_dir,
        f"/Users/muhammedbozkurt/Desktop/Others/zerospike/zerospike-store-r93/android-tablet7/{lang}",
        dev_y=360, margin_x=48, headline_size=58, sub_size=25, chip_size=22, bezel=11, radius=42,
    )


if __name__ == "__main__":
    lang = sys.argv[1] if len(sys.argv) > 1 else "tr"
    build_all(lang)
