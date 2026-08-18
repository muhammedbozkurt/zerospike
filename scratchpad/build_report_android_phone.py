#!/usr/bin/env python3
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image, ImageDraw
from compose import (
    new_canvas_with_header, draw_chip_at, font, F_BOLD, measure_chip,
    fit_header_and_chip, verify_output, align_for,
)
from build_report import draw_back_page, draw_front_page, soft_shadow_paste, report_data
from i18n_copy import REPORT_STRINGS, LANGS, frame_copy

OUT_BASE = "/Users/muhammedbozkurt/Desktop/Others/zerospike/zerospike-store/android-phone-1080x1920"
CANVAS = (1080, 1920)


def build_all(lang):
    OUT = os.path.join(OUT_BASE, lang)
    os.makedirs(OUT, exist_ok=True)
    BASE = dict(canvas=CANVAS, margin_x=54, headline_top=54, headline_size=70, sub_size=30,
                chip_size=27, text_w=int(CANVAS[0] * 0.80))
    headline, sub, chip_text = frame_copy(lang, "06-report", platform="android")
    S = REPORT_STRINGS[lang]
    cfg = dict(BASE, headline=headline, sub=sub, lang=lang, align=align_for(lang))

    page_w = int(CANVAS[0] * 0.62)
    page_h = int(page_w / 0.707)
    front_x = int(CANVAS[0] * 0.075)
    front_y = 640
    back_x = front_x + int(page_w * 0.28)
    back_y = front_y - int(page_h * 0.065)
    assert front_y + page_h <= CANVAS[1] - 30, "report overflows android phone canvas"

    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    f_chip = font(F_BOLD, cfg["chip_size"], lang=lang)
    chip_w, chip_h, *_ = measure_chip(probe, chip_text, f_chip, "📄")
    cfg["sub_max_lines"], chip_y, fits = fit_header_and_chip(cfg, chip_h, back_y, 18, 6)
    if not fits:
        print(f"  WARN [{lang}] 06-report chip overlaps the header band")

    canvas, draw, y_after = new_canvas_with_header(cfg)
    chip_x = (CANVAS[0] - chip_w) // 2 if cfg["align"] == "center" else CANVAS[0] - cfg["margin_x"] - chip_w
    draw_chip_at(canvas, chip_text, chip_x, chip_y, f_chip, emoji_ch="📄")

    soft_shadow_paste(canvas, back_x, back_y, page_w, page_h, radius=6, blur=18, alpha=70, grow=10)
    canvas.paste(draw_back_page(page_w, page_h, S=S, lang=lang), (back_x, back_y))

    soft_shadow_paste(canvas, front_x, front_y, page_w, page_h, radius=6, blur=24, alpha=100, grow=13)
    canvas.paste(draw_front_page(page_w, page_h, report_data(lang), S=S, lang=lang), (front_x, front_y))

    out_path = os.path.join(OUT, "06-report.png")
    canvas.save(out_path)
    print("wrote", out_path, canvas.size, "page", page_w, page_h, "aspect", round(page_w / page_h, 3))
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
