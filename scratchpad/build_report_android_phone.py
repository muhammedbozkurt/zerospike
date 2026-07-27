#!/usr/bin/env python3
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from compose import new_canvas_with_header, draw_chip_at, font, F_BOLD, measure_chip
from build_report import draw_back_page, draw_front_page, soft_shadow_paste
from i18n_copy import FRAME_COPY, REPORT_STRINGS, PROFILE_NAME


def build_all(lang):
    OUT = f"/Users/muhammedbozkurt/Desktop/Others/zerospike/zerospike-store-r93/android-phone/{lang}"
    os.makedirs(OUT, exist_ok=True)
    CANVAS = (1080, 1920)
    BASE = dict(canvas=CANVAS, margin_x=54, headline_top=54, headline_size=70, sub_size=30,
                chip_size=27, text_w=int(CANVAS[0] * 0.80))
    headline, sub, chip_text = FRAME_COPY[lang]["06-report"]
    S = REPORT_STRINGS[lang]
    cfg = dict(BASE, headline=headline, sub=sub)
    canvas, draw, y_after = new_canvas_with_header(cfg)

    f_chip = font(F_BOLD, cfg["chip_size"])
    w_, h_, *_ = measure_chip(draw, chip_text, f_chip, "📄")
    x_ = CANVAS[0] - cfg["margin_x"] - w_
    draw_chip_at(canvas, chip_text, x_, y_after + 18, f_chip, emoji_ch="📄")

    page_w = int(CANVAS[0] * 0.62)
    page_h = int(page_w / 0.707)
    front_x = int(CANVAS[0] * 0.075)
    front_y = 640
    back_x = front_x + int(page_w * 0.28)
    back_y = front_y - int(page_h * 0.065)
    assert front_y + page_h <= CANVAS[1] - 30, "report overflows android phone canvas"

    soft_shadow_paste(canvas, back_x, back_y, page_w, page_h, radius=6, blur=18, alpha=70, grow=10)
    back = draw_back_page(page_w, page_h, S=S)
    canvas.paste(back, (back_x, back_y))

    data = dict(profile=PROFILE_NAME[lang], range="24.06.2026 - 24.07.2026", created="24.07.2026 23:26",
                avg=123, gmi="6.3", tir=74, sd=33, cv=27, low=11, vlow=0, lowp=6, high=20, vhigh=0,
                n=126, hours=8, median=113, dose="11,8", inj=32)
    soft_shadow_paste(canvas, front_x, front_y, page_w, page_h, radius=6, blur=24, alpha=100, grow=13)
    front = draw_front_page(page_w, page_h, data, S=S)
    canvas.paste(front, (front_x, front_y))

    canvas.save(os.path.join(OUT, "06-report.png"))
    print("wrote 06-report", canvas.size, "page", page_w, page_h, "aspect", round(page_w / page_h, 3))


if __name__ == "__main__":
    lang = sys.argv[1] if len(sys.argv) > 1 else "tr"
    build_all(lang)
