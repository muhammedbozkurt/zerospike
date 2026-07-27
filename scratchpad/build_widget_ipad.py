#!/usr/bin/env python3
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from compose import new_canvas_with_header, draw_chip_at, draw_device, font, F_BOLD, measure_chip
from build_widget import lockscreen_scene
from i18n_copy import FRAME_COPY, WIDGET_STRINGS


def build_all(lang):
    OUT = f"/Users/muhammedbozkurt/Desktop/Others/zerospike/zerospike-store-r93/ipad-2064x2752/{lang}"
    os.makedirs(OUT, exist_ok=True)
    CANVAS = (2064, 2752)
    SCALE = 2064 / 1284.0
    BASE = dict(
        canvas=CANVAS, margin_x=int(64 * SCALE), headline_top=int(64 * SCALE), headline_size=int(84 * SCALE),
        sub_size=int(36 * SCALE), chip_size=int(32 * SCALE), text_w=int(CANVAS[0] * 0.80),
    )
    headline, sub, chip_text = FRAME_COPY[lang]["03-widget"]
    WS = WIDGET_STRINGS[lang]
    cfg = dict(BASE, headline=headline, sub=sub)
    canvas, draw, y_after = new_canvas_with_header(cfg)

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

    scene = lockscreen_scene(inner_w, inner_h, "09:41", WS["date"], 124, 72, S=WS)
    draw_device(canvas, scene, dev_x, DEV_Y, dev_w, BEZEL, RADIUS)

    f_chip = font(F_BOLD, cfg["chip_size"])
    w, h, *_ = measure_chip(draw, chip_text, f_chip, None)
    x = CANVAS[0] - cfg["margin_x"] - w
    draw_chip_at(canvas, chip_text, x, y_after + int(26 * SCALE), f_chip, dot=(46, 230, 255))

    canvas.save(os.path.join(OUT, "03-widget.png"))
    print("wrote 03-widget", canvas.size, "dev", dev_x, DEV_Y, dev_w)


if __name__ == "__main__":
    lang = sys.argv[1] if len(sys.argv) > 1 else "tr"
    build_all(lang)
