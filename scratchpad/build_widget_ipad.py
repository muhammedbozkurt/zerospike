#!/usr/bin/env python3
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image, ImageDraw
from compose import (
    new_canvas_with_header, draw_chip_at, draw_device, font, F_BOLD, measure_chip,
    fit_header_and_chip, verify_output,
)
from build_widget import lockscreen_scene
from i18n_copy import WIDGET_STRINGS, LANGS, frame_copy

OUT_BASE = "/Users/muhammedbozkurt/Desktop/Others/zerospike/zerospike-store/ipad-2064x2752"
CANVAS = (2064, 2752)


def build_all(lang):
    OUT = os.path.join(OUT_BASE, lang)
    os.makedirs(OUT, exist_ok=True)
    SCALE = 2064 / 1284.0
    BASE = dict(
        canvas=CANVAS, margin_x=int(64 * SCALE), headline_top=int(64 * SCALE), headline_size=int(84 * SCALE),
        sub_size=int(36 * SCALE), chip_size=int(32 * SCALE), text_w=int(CANVAS[0] * 0.80),
    )
    headline, sub, chip_text = frame_copy(lang, "03-widget")
    WS = WIDGET_STRINGS[lang]
    cfg = dict(BASE, headline=headline, sub=sub, lang=lang)

    DEV_Y = int(460 * SCALE)
    BEZEL = int(16 * SCALE)
    RADIUS = int(64 * SCALE)
    SAFE_BOTTOM = CANVAS[1] - int(24 * SCALE)
    DEV_W_STD = CANVAS[0] - 2 * BASE["margin_x"]

    # match the other iPad frames' content aspect (~1.28 h/w) instead of the iPhone's tall aspect
    CONTENT_ASPECT = 1.28
    budget_h = SAFE_BOTTOM - DEV_Y
    inner_h_max = budget_h - 2 * BEZEL
    inner_w_needed = inner_h_max / CONTENT_ASPECT
    dev_w = min(DEV_W_STD, int(inner_w_needed + 2 * BEZEL))
    inner_w = dev_w - 2 * BEZEL
    inner_h = int(inner_w * CONTENT_ASPECT)
    dev_x = (CANVAS[0] - dev_w) // 2

    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    f_chip = font(F_BOLD, cfg["chip_size"], lang=lang)
    chip_w, chip_h, *_ = measure_chip(probe, chip_text, f_chip, None)
    cfg["sub_max_lines"], chip_y, fits = fit_header_and_chip(
        cfg, chip_h, DEV_Y, int(26 * SCALE), int(8 * SCALE))
    if not fits:
        print(f"  WARN [{lang}] 03-widget chip overlaps the header band")

    canvas, draw, y_after = new_canvas_with_header(cfg)
    scene = lockscreen_scene(inner_w, inner_h, "09:41", WS["date"], 124, 72, S=WS, lang=lang)
    draw_device(canvas, scene, dev_x, DEV_Y, dev_w, BEZEL, RADIUS)
    draw_chip_at(canvas, chip_text, CANVAS[0] - cfg["margin_x"] - chip_w, chip_y, f_chip, dot=(46, 230, 255))

    out_path = os.path.join(OUT, "03-widget.png")
    canvas.save(out_path)
    print("wrote", out_path, canvas.size, "dev", dev_x, DEV_Y, dev_w)
    return [(out_path, CANVAS)]


def main(argv):
    langs = argv[1:] or list(LANGS)
    if langs == ["all"]:
        langs = list(LANGS)
    written = []
    for lang in langs:
        written += build_all(lang)
    bad = [p for p, size in written if not verify_output(p, size)]
    print(f"{len(written)} file(s): {len(written) - len(bad)} OK, {len(bad)} FAIL")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
