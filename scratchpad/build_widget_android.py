#!/usr/bin/env python3
"""03-widget for Android: lock screen (bold Android-style clock) + ongoing
notification card + Material home-screen widget, not an iOS reskin."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image, ImageDraw
from compose import (
    new_canvas_with_header, draw_chip_at, draw_device, font, F_BOLD, measure_chip,
    hn, HN_BOLD, HN_MEDIUM, HN_REGULAR, vertical_gradient,
)

THEME_G1 = (7, 13, 19)
THEME_G2 = (16, 34, 44)
ACCENT = (46, 230, 255)
TARGET = (34, 227, 154)
INK = (234, 246, 250)
MUTED = (146, 170, 182)


def lockscreen_scene_android(w, h, time_str, date_str, avg_value, timer_min, S=None):
    if S is None:
        from i18n_copy import WIDGET_STRINGS
        S = WIDGET_STRINGS["tr"]
    scene = vertical_gradient((w, h), THEME_G2, THEME_G1)
    draw = ImageDraw.Draw(scene)

    # Android lock-screen clock: bold, medium-large (not ultralight like iOS)
    f_clock = hn(int(w * 0.24), HN_MEDIUM)
    clock_top = int(h * 0.085)
    cw = draw.textlength(time_str, font=f_clock)
    cbbox = draw.textbbox((0, clock_top), time_str, font=f_clock)
    draw.text(((w - cw) / 2, clock_top), time_str, font=f_clock, fill=(255, 255, 255))

    f_date = hn(int(w * 0.040), HN_REGULAR)
    dw = draw.textlength(date_str, font=f_date)
    date_top = cbbox[3] + int(h * 0.018)
    draw.text(((w - dw) / 2, date_top), date_str, font=f_date, fill=MUTED)

    # Ongoing notification (Android's Live-Activity equivalent) - a Material
    # notification-shade card, full width, icon + text + progress.
    n_x0, n_y0 = int(w * 0.055), date_top + int(h * 0.055)
    n_w, n_h = w - 2 * n_x0, int(h * 0.135)
    n_card = vertical_gradient((n_w, n_h), (22, 35, 44), (13, 22, 29))
    nmask = Image.new("L", (n_w, n_h), 0)
    ImageDraw.Draw(nmask).rounded_rectangle([0, 0, n_w - 1, n_h - 1], radius=int(w * 0.045), fill=255)
    scene.paste(n_card, (n_x0, n_y0), nmask)

    icon_size = int(n_h * 0.5)
    icon_x, icon_y = n_x0 + int(w * 0.03), n_y0 + int(w * 0.03)
    icon_grad = vertical_gradient((icon_size, icon_size), (127, 244, 255), (46, 230, 255))
    imask = Image.new("L", (icon_size, icon_size), 0)
    ImageDraw.Draw(imask).rounded_rectangle([0, 0, icon_size - 1, icon_size - 1], radius=int(icon_size * 0.24), fill=255)
    scene.paste(icon_grad, (icon_x, icon_y), imask)
    pts = []
    px, py = icon_x + icon_size * 0.16, icon_y + icon_size * 0.55
    for dx, dy in [(0, 0), (0.16, 0), (0.26, -0.30), (0.38, 0.34), (0.48, 0), (0.70, 0)]:
        pts.append((px + dx * icon_size, py + dy * icon_size))
    draw.line(pts, fill=(3, 24, 28), width=max(3, icon_size // 13), joint="curve")

    f_app = hn(int(w * 0.028), HN_BOLD)
    f_title = hn(int(w * 0.036), HN_BOLD)
    tx = icon_x + icon_size + int(w * 0.035)
    draw.text((tx, n_y0 + int(w * 0.028)), S["ongoing"], font=f_app, fill=ACCENT)
    draw.text((tx, n_y0 + int(w * 0.028) + int(w * 0.045)), S["timer_title"], font=f_title, fill=INK)

    bar_y = n_y0 + n_h - int(w * 0.055)
    bar_h = max(4, int(w * 0.012))
    bar_x0, bar_x1 = tx, n_x0 + n_w - int(w * 0.03)
    draw.rounded_rectangle([bar_x0, bar_y, bar_x1, bar_y + bar_h], radius=bar_h // 2, fill=(28, 42, 50))
    frac = 0.30
    draw.rounded_rectangle([bar_x0, bar_y, bar_x0 + int((bar_x1 - bar_x0) * frac), bar_y + bar_h],
                            radius=bar_h // 2, fill=ACCENT)
    f_timer = hn(int(w * 0.030), HN_BOLD)
    tstr = S["min_left"].format(n=timer_min)
    draw.text((bar_x1 - draw.textlength(tstr, font=f_timer), n_y0 + int(w * 0.028)), tstr, font=f_timer, fill=MUTED)

    # Material home-screen widget card, below
    card_x0 = n_x0
    card_y0 = n_y0 + n_h + int(h * 0.03)
    card_w, card_h = n_w, int(h * 0.20)
    card = vertical_gradient((card_w, card_h), (22, 35, 44), (14, 24, 31))
    cmask = Image.new("L", (card_w, card_h), 0)
    ImageDraw.Draw(cmask).rounded_rectangle([0, 0, card_w - 1, card_h - 1], radius=int(w * 0.05), fill=255)
    scene.paste(card, (card_x0, card_y0), cmask)
    # sized off card_h (not w) so the layout stays self-consistent at any
    # aspect ratio - a wide tablet card and a narrow phone card both fit
    # their text without the value overlapping the "Son 7 gün" row.
    f_lbl = hn(int(card_h * 0.115), HN_BOLD)
    f_val = hn(int(card_h * 0.34), HN_BOLD)
    f_sub = hn(int(card_h * 0.105), HN_REGULAR)
    pad = int(card_h * 0.13)
    label_y = card_y0 + pad
    value_y = label_y + int(card_h * 0.16)
    dot_y = card_y0 + card_h - pad - int(card_h * 0.08)
    draw.text((card_x0 + pad, label_y), S["avg_glucose"], font=f_lbl, fill=MUTED)
    draw.text((card_x0 + pad, value_y), str(avg_value), font=f_val, fill=TARGET)
    vw = draw.textlength(str(avg_value), font=f_val)
    draw.text((card_x0 + pad + vw + 8, value_y + int(card_h * 0.19)), "mg/dL", font=f_sub, fill=MUTED)
    draw.ellipse([card_x0 + pad, dot_y, card_x0 + pad + int(card_h * 0.06), dot_y + int(card_h * 0.06)], fill=TARGET)
    draw.text((card_x0 + pad + int(card_h * 0.09), dot_y - int(card_h * 0.02)), S["last7"], font=f_sub, fill=TARGET)

    hw = int(w * 0.30)
    draw.rounded_rectangle([(w - hw) / 2, h - int(h * 0.012) - 5, (w + hw) / 2, h - int(h * 0.012)],
                            radius=3, fill=(200, 210, 216))
    return scene


def build_all(lang):
    from i18n_copy import FRAME_COPY, WIDGET_STRINGS
    OUT = f"/Users/muhammedbozkurt/Desktop/Others/zerospike/zerospike-store-r93/android-phone/{lang}"
    os.makedirs(OUT, exist_ok=True)
    CANVAS = (1080, 1920)
    BASE = dict(canvas=CANVAS, margin_x=54, headline_top=54, headline_size=70, sub_size=30,
                chip_size=27, text_w=int(CANVAS[0] * 0.80))
    headline, sub, chip_text = FRAME_COPY[lang]["03-widget"]
    WS = WIDGET_STRINGS[lang]
    cfg = dict(BASE, headline=headline, sub=sub)
    canvas, draw, y_after = new_canvas_with_header(cfg)

    DEV_Y = 388
    BEZEL = 13
    RADIUS = 52
    DEV_W = CANVAS[0] - 2 * BASE["margin_x"]
    SAFE_BOTTOM = CANVAS[1] - 20
    inner_w = DEV_W - 2 * BEZEL
    inner_h = SAFE_BOTTOM - DEV_Y - 2 * BEZEL

    scene = lockscreen_scene_android(inner_w, inner_h, "9:41", WS["date"], 123, 72, S=WS)
    dev_x = (CANVAS[0] - DEV_W) // 2
    draw_device(canvas, scene, dev_x, DEV_Y, DEV_W, BEZEL, RADIUS)
    d2 = ImageDraw.Draw(canvas)
    cx = dev_x + DEV_W // 2
    cy = DEV_Y + BEZEL + 22
    r = 8
    d2.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(3, 3, 4))

    f_chip = font(F_BOLD, cfg["chip_size"])
    w, h, *_ = measure_chip(draw, chip_text, f_chip, None)
    x = CANVAS[0] - cfg["margin_x"] - w
    draw_chip_at(canvas, chip_text, x, y_after + 18, f_chip, dot=(46, 230, 255))

    canvas.save(os.path.join(OUT, "03-widget.png"))
    print("wrote 03-widget", canvas.size)


if __name__ == "__main__":
    lang = sys.argv[1] if len(sys.argv) > 1 else "tr"
    build_all(lang)
