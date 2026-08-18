#!/usr/bin/env python3
"""03-widget + 06-report on the two Android tablet canvases.

Both panels are synthetic (no capture exists for either), so unlike
build_android_tablet.py this file draws its own scene instead of reframing an
iPad raw."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image, ImageDraw
from compose import (
    new_canvas_with_header, draw_chip_at, draw_device, font, F_BOLD, measure_chip,
    fit_header_and_chip, verify_output, align_for,
)
from build_widget_android import lockscreen_scene_android
from build_report import draw_back_page, draw_front_page, soft_shadow_paste, report_data
from i18n_copy import WIDGET_STRINGS, REPORT_STRINGS, LANGS, frame_copy

OUT_ROOT = "/Users/muhammedbozkurt/Desktop/Others/zerospike/zerospike-store"

CONFIGS = [
    dict(name="android-tablet10-1600x2560", canvas=(1600, 2560), dev_y=480, margin_x=70,
         headline_size=76, sub_size=33, chip_size=29, bezel=14, radius=56, content_aspect=1.28),
    dict(name="android-tablet7-1080x1920", canvas=(1080, 1920), dev_y=360, margin_x=48,
         headline_size=58, sub_size=25, chip_size=22, bezel=11, radius=42, content_aspect=1.28),
]


def build_all(lang):
    WS = WIDGET_STRINGS[lang]
    RS = REPORT_STRINGS[lang]
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    written = []

    for cfg_ in CONFIGS:
        OUT = os.path.join(OUT_ROOT, cfg_["name"], lang)
        os.makedirs(OUT, exist_ok=True)
        CANVAS = cfg_["canvas"]
        BASE = dict(canvas=CANVAS, margin_x=cfg_["margin_x"], headline_top=cfg_["margin_x"],
                    headline_size=cfg_["headline_size"], sub_size=cfg_["sub_size"], chip_size=cfg_["chip_size"],
                    text_w=int(CANVAS[0] * 0.80))
        DEV_Y = cfg_["dev_y"]
        BEZEL = cfg_["bezel"]
        RADIUS = cfg_["radius"]
        DEV_W_STD = CANVAS[0] - 2 * cfg_["margin_x"]
        SAFE_BOTTOM = CANVAS[1] - int(CANVAS[1] * 0.008)
        gap = int(cfg_["margin_x"] * 0.4)
        pad = int(cfg_["margin_x"] * 0.15)

        # ---- 03-widget ----
        headline, sub, chip_text = frame_copy(lang, "03-widget", platform="android")
        cfg = dict(BASE, headline=headline, sub=sub, lang=lang, align=align_for(lang))

        budget_h = SAFE_BOTTOM - DEV_Y
        inner_h_max = budget_h - 2 * BEZEL
        inner_w_needed = inner_h_max / cfg_["content_aspect"]
        dev_w = min(DEV_W_STD, int(inner_w_needed + 2 * BEZEL))
        inner_w = dev_w - 2 * BEZEL
        inner_h = int(inner_w * cfg_["content_aspect"])
        dev_x = (CANVAS[0] - dev_w) // 2

        f_chip = font(F_BOLD, cfg["chip_size"], lang=lang)
        chip_w, chip_h, *_ = measure_chip(probe, chip_text, f_chip, None)
        cfg["sub_max_lines"], chip_y, fits = fit_header_and_chip(cfg, chip_h, DEV_Y, gap, pad)
        if not fits:
            print(f"  WARN [{lang}] {cfg_['name']} 03-widget chip overlaps the header band")

        canvas, draw, y_after = new_canvas_with_header(cfg)
        scene = lockscreen_scene_android(inner_w, inner_h, "9:41", WS["date"], 123, 72, S=WS, lang=lang)
        draw_device(canvas, scene, dev_x, DEV_Y, dev_w, BEZEL, RADIUS)
        d2 = ImageDraw.Draw(canvas)
        cx = dev_x + dev_w // 2
        cy = DEV_Y + BEZEL + int(BEZEL * 1.6)
        r = max(6, int(BEZEL * 0.6))
        d2.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(3, 3, 4))
        chip_x = (CANVAS[0] - chip_w) // 2 if cfg["align"] == "center" else CANVAS[0] - cfg["margin_x"] - chip_w
        draw_chip_at(canvas, chip_text, chip_x, chip_y, f_chip, dot=(46, 230, 255))

        out_path = os.path.join(OUT, "03-widget.png")
        canvas.save(out_path)
        print("wrote", out_path, canvas.size)
        written.append((out_path, CANVAS))

        # ---- 06-report ----
        headline, sub, chip_text = frame_copy(lang, "06-report", platform="android")
        cfg = dict(BASE, headline=headline, sub=sub, lang=lang, align=align_for(lang))

        page_w = int(CANVAS[0] * 0.60)
        page_h = int(page_w / 0.707)
        front_x = int(CANVAS[0] * 0.09)

        f_chip = font(F_BOLD, cfg["chip_size"], lang=lang)
        chip_w, chip_h, *_ = measure_chip(probe, chip_text, f_chip, "📄")
        # the chip's floor is the top sheet, which itself sits below the chip -
        # so solve the header against a provisional ceiling, then lay the pages
        # out under whatever the chip actually took
        cfg["sub_max_lines"], chip_y, fits = fit_header_and_chip(
            cfg, chip_h, int(CANVAS[1] * 0.32), gap, pad)
        if not fits:
            print(f"  WARN [{lang}] {cfg_['name']} 06-report chip overlaps the header band")

        canvas, draw, y_after = new_canvas_with_header(cfg)
        chip_x = (CANVAS[0] - chip_w) // 2 if cfg["align"] == "center" else CANVAS[0] - cfg["margin_x"] - chip_w
        draw_chip_at(canvas, chip_text, chip_x, chip_y, f_chip, emoji_ch="📄")

        # center the page(s) in the space below the header/chip, not pinned to its
        # top - matches the android-phone report's vertically-balanced look.
        content_top = chip_y + chip_h + int(cfg_["margin_x"] * 0.5)
        bottom_margin = int(CANVAS[1] * 0.02)
        front_y = content_top + max(0, (CANVAS[1] - bottom_margin - content_top - page_h) // 2)
        back_x = front_x + int(page_w * 0.28)
        back_y = front_y - int(page_h * 0.065)
        assert front_y + page_h <= CANVAS[1] - bottom_margin, f"report overflow on {cfg_['name']}"

        scale = CANVAS[0] / 1284.0
        soft_shadow_paste(canvas, back_x, back_y, page_w, page_h, radius=6, blur=int(26 * scale), alpha=70, grow=int(14 * scale))
        canvas.paste(draw_back_page(page_w, page_h, S=RS, lang=lang), (back_x, back_y))

        soft_shadow_paste(canvas, front_x, front_y, page_w, page_h, radius=6, blur=int(34 * scale), alpha=100, grow=int(18 * scale))
        canvas.paste(draw_front_page(page_w, page_h, report_data(lang), S=RS, lang=lang), (front_x, front_y))

        out_path = os.path.join(OUT, "06-report.png")
        canvas.save(out_path)
        print("wrote", out_path, canvas.size, "page", page_w, page_h)
        written.append((out_path, CANVAS))
    return written


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
