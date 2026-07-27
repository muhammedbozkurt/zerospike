#!/usr/bin/env python3
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image, ImageDraw
from compose import (
    new_canvas_with_header, draw_device, draw_chip_at, load_cropped_shot, font, F_BOLD,
    measure_chip,
)
from i18n_copy import FRAME_COPY, CHIP_EMOJI

RAW_BASE = "/Users/muhammedbozkurt/Desktop/Others/zerospike/raw/android-phone"
OUT_BASE = "/Users/muhammedbozkurt/Desktop/Others/zerospike/zerospike-store-r93/android-phone"

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

CROP_BOTTOM = {"01-ring": 2185, "04-food": 2215, "05-insights": 2260, "07-spike": 2380}
BODYMAP_TOP_CROP = 2050
BODYMAP_CARD_HEIGHT = 460  # rotation card crop height, incl. small top/bottom margin (see find_card_top)


def find_card_top(bottom_img, x=50, scan_from=900, scan_to=1900, gap=30):
    """Scroll depth on the bodymap screen isn't perfectly reproducible run to
    run, so a fixed pixel crop for the bottom half can duplicate content
    already shown in the top half or leave a gap. Find the rotation card's own
    top border instead: comparing each row against a row `gap` px above it
    (rather than one fixed reference) tells apart a real border - a sharp,
    sustained jump - from the screen's soft background gradient and from thin
    one-off highlight lines."""
    px = bottom_img.load()
    for y in range(scan_from, scan_to):
        c, ref = px[x, y], px[x, y - gap]
        if abs(c[0] - ref[0]) + abs(c[1] - ref[1]) + abs(c[2] - ref[2]) > 15:
            c2 = px[x, y + 60]
            if abs(c2[0] - ref[0]) + abs(c2[1] - ref[1]) + abs(c2[2] - ref[2]) > 10:
                return y
    return scan_from


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
    canvas, draw, y_after = new_canvas_with_header(cfg)
    if dev_w is None:
        dev_w = DEV_W_STD
    dev_x = (CANVAS[0] - dev_w) // 2
    dev_box = draw_device(canvas, shot_img, dev_x, DEV_Y, dev_w, BEZEL, RADIUS)
    add_punch_hole(canvas, dev_x, DEV_Y, dev_w)
    f_chip = font(F_BOLD, cfg["chip_size"])
    cy = y_after + 18
    for ch in chips:
        w, h, *_ = measure_chip(draw, ch["text"], f_chip, ch.get("emoji"))
        x = CANVAS[0] - cfg["margin_x"] - w
        if cy + h > DEV_Y - 6:
            break
        draw_chip_at(canvas, ch["text"], x, cy, f_chip, emoji_ch=ch.get("emoji"), dot=ch.get("dot"))
        cy += h + 14
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
