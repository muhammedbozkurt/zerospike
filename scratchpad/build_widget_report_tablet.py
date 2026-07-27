#!/usr/bin/env python3
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from compose import new_canvas_with_header, draw_chip_at, draw_device, font, F_BOLD, measure_chip
from build_widget_android import lockscreen_scene_android
from build_report import draw_back_page, draw_front_page, soft_shadow_paste
from i18n_copy import FRAME_COPY, WIDGET_STRINGS, REPORT_STRINGS, PROFILE_NAME
from PIL import ImageDraw

CONFIGS = [
    dict(name="android-tablet10", canvas=(1600, 2560), dev_y=480, margin_x=70, headline_size=76,
         sub_size=33, chip_size=29, bezel=14, radius=56, content_aspect=1.28),
    dict(name="android-tablet7", canvas=(1080, 1920), dev_y=360, margin_x=48, headline_size=58,
         sub_size=25, chip_size=22, bezel=11, radius=42, content_aspect=1.28),
]


def build_all(lang):
    copy = FRAME_COPY[lang]
    WS = WIDGET_STRINGS[lang]
    RS = REPORT_STRINGS[lang]

    for cfg_ in CONFIGS:
        OUT = f"/Users/muhammedbozkurt/Desktop/Others/zerospike/zerospike-store-r93/{cfg_['name']}/{lang}"
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

        # ---- 03-widget ----
        headline, sub, chip_text = copy["03-widget"]
        cfg = dict(BASE, headline=headline, sub=sub)
        canvas, draw, y_after = new_canvas_with_header(cfg)

        budget_h = SAFE_BOTTOM - DEV_Y
        inner_h_max = budget_h - 2 * BEZEL
        inner_w_needed = inner_h_max / cfg_["content_aspect"]
        dev_w = min(DEV_W_STD, int(inner_w_needed + 2 * BEZEL))
        inner_w = dev_w - 2 * BEZEL
        inner_h = int(inner_w * cfg_["content_aspect"])
        dev_x = (CANVAS[0] - dev_w) // 2

        scene = lockscreen_scene_android(inner_w, inner_h, "9:41", WS["date"], 123, 72, S=WS)
        draw_device(canvas, scene, dev_x, DEV_Y, dev_w, BEZEL, RADIUS)
        d2 = ImageDraw.Draw(canvas)
        cx = dev_x + dev_w // 2
        cy = DEV_Y + BEZEL + int(BEZEL * 1.6)
        r = max(6, int(BEZEL * 0.6))
        d2.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(3, 3, 4))

        f_chip = font(F_BOLD, cfg["chip_size"])
        w, h, *_ = measure_chip(draw, chip_text, f_chip, None)
        x = CANVAS[0] - cfg["margin_x"] - w
        draw_chip_at(canvas, chip_text, x, y_after + int(cfg_["margin_x"] * 0.4), f_chip, dot=(46, 230, 255))
        canvas.save(os.path.join(OUT, "03-widget.png"))
        print("wrote", os.path.join(OUT, "03-widget.png"), canvas.size)

        # ---- 06-report ----
        headline, sub, chip_text = copy["06-report"]
        cfg = dict(BASE, headline=headline, sub=sub)
        canvas, draw, y_after = new_canvas_with_header(cfg)

        f_chip = font(F_BOLD, cfg["chip_size"])
        w_, h_, *_ = measure_chip(draw, chip_text, f_chip, "📄")
        x_ = CANVAS[0] - cfg["margin_x"] - w_
        chip_y = y_after + int(cfg_["margin_x"] * 0.4)
        draw_chip_at(canvas, chip_text, x_, chip_y, f_chip, emoji_ch="📄")

        page_w = int(CANVAS[0] * 0.60)
        page_h = int(page_w / 0.707)
        front_x = int(CANVAS[0] * 0.09)
        # center the page(s) in the space below the header/chip, not pinned to its
        # top - matches the android-phone report's vertically-balanced look.
        content_top = chip_y + h_ + int(cfg_["margin_x"] * 0.5)
        bottom_margin = int(CANVAS[1] * 0.02)
        front_y = content_top + max(0, (CANVAS[1] - bottom_margin - content_top - page_h) // 2)
        back_x = front_x + int(page_w * 0.28)
        back_y = front_y - int(page_h * 0.065)
        assert front_y + page_h <= CANVAS[1] - int(CANVAS[1] * 0.02), f"report overflow on {cfg_['name']}"

        scale = CANVAS[0] / 1284.0
        soft_shadow_paste(canvas, back_x, back_y, page_w, page_h, radius=6, blur=int(26 * scale), alpha=70, grow=int(14 * scale))
        back = draw_back_page(page_w, page_h, S=RS)
        canvas.paste(back, (back_x, back_y))

        data = dict(profile=PROFILE_NAME[lang], range="24.06.2026 - 24.07.2026", created="24.07.2026 23:26",
                    avg=123, gmi="6.3", tir=74, sd=33, cv=27, low=11, vlow=0, lowp=6, high=20, vhigh=0,
                    n=126, hours=8, median=113, dose="11,8", inj=32)
        soft_shadow_paste(canvas, front_x, front_y, page_w, page_h, radius=6, blur=int(34 * scale), alpha=100, grow=int(18 * scale))
        front = draw_front_page(page_w, page_h, data, S=RS)
        canvas.paste(front, (front_x, front_y))
        canvas.save(os.path.join(OUT, "06-report.png"))
        print("wrote", os.path.join(OUT, "06-report.png"), canvas.size, "page", page_w, page_h)


if __name__ == "__main__":
    lang = sys.argv[1] if len(sys.argv) > 1 else "tr"
    build_all(lang)
