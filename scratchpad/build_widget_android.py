#!/usr/bin/env python3
"""03-widget for Android: lock screen (bold Android-style clock) + ongoing
notification card + Material home-screen widget, not an iOS reskin."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image, ImageDraw
from compose import (
    new_canvas_with_header, draw_chip_at, draw_device, font, F_BOLD, measure_chip,
    hn, HN_BOLD, HN_MEDIUM, HN_REGULAR, vertical_gradient,
    fit_header_and_chip, fit_font, verify_output,
)

THEME_G1 = (7, 13, 19)
THEME_G2 = (16, 34, 44)
ACCENT = (46, 230, 255)
TARGET = (34, 227, 154)
INK = (234, 246, 250)
MUTED = (146, 170, 182)


def lockscreen_scene_android(w, h, time_str, date_str, avg_value, timer_min, S=None, lang=None):
    """See build_widget.lockscreen_scene for why `lang` reaches only the
    translated labels and never the digits."""
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

    f_date = fit_font(draw, date_str, int(w * 0.86), int(w * 0.040), HN_REGULAR, lang=lang)
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

    tx = icon_x + icon_size + int(w * 0.035)
    bar_x0, bar_x1 = tx, n_x0 + n_w - int(w * 0.03)

    # "noch 72 Min." / "残り72分" share the top row with the app line, and the
    # title owns the row under it, so both are measured against what is left
    tstr = S["min_left"].format(n=timer_min)
    f_timer = fit_font(draw, tstr, (bar_x1 - tx) * 0.45, int(w * 0.030), HN_BOLD, lang=lang)
    timer_w = draw.textlength(tstr, font=f_timer)
    f_app = fit_font(draw, S["ongoing"], (bar_x1 - tx) - timer_w - int(w * 0.02),
                     int(w * 0.028), HN_BOLD, lang=lang)
    f_title = fit_font(draw, S["timer_title"], bar_x1 - tx, int(w * 0.036), HN_BOLD, lang=lang)
    draw.text((tx, n_y0 + int(w * 0.028)), S["ongoing"], font=f_app, fill=ACCENT)
    draw.text((tx, n_y0 + int(w * 0.028) + int(w * 0.045)), S["timer_title"], font=f_title, fill=INK)

    bar_y = n_y0 + n_h - int(w * 0.055)
    bar_h = max(4, int(w * 0.012))
    draw.rounded_rectangle([bar_x0, bar_y, bar_x1, bar_y + bar_h], radius=bar_h // 2, fill=(28, 42, 50))
    frac = 0.30
    draw.rounded_rectangle([bar_x0, bar_y, bar_x0 + int((bar_x1 - bar_x0) * frac), bar_y + bar_h],
                            radius=bar_h // 2, fill=ACCENT)
    draw.text((bar_x1 - timer_w, n_y0 + int(w * 0.028)), tstr, font=f_timer, fill=MUTED)

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
    pad = int(card_h * 0.13)
    card_inner = card_w - 2 * pad
    f_lbl = fit_font(draw, S["avg_glucose"], card_inner, int(card_h * 0.115), HN_BOLD, lang=lang)
    f_val = hn(int(card_h * 0.34), HN_BOLD)
    f_unit = hn(int(card_h * 0.105), HN_REGULAR)
    f_sub = fit_font(draw, S["last7"], card_inner - int(card_h * 0.09), int(card_h * 0.105),
                     HN_REGULAR, lang=lang)
    label_y = card_y0 + pad
    value_y = label_y + int(card_h * 0.16)
    dot_y = card_y0 + card_h - pad - int(card_h * 0.08)
    draw.text((card_x0 + pad, label_y), S["avg_glucose"], font=f_lbl, fill=MUTED)
    draw.text((card_x0 + pad, value_y), str(avg_value), font=f_val, fill=TARGET)
    vw = draw.textlength(str(avg_value), font=f_val)
    draw.text((card_x0 + pad + vw + 8, value_y + int(card_h * 0.19)), "mg/dL", font=f_unit, fill=MUTED)
    draw.ellipse([card_x0 + pad, dot_y, card_x0 + pad + int(card_h * 0.06), dot_y + int(card_h * 0.06)], fill=TARGET)
    draw.text((card_x0 + pad + int(card_h * 0.09), dot_y - int(card_h * 0.02)), S["last7"], font=f_sub, fill=TARGET)

    hw = int(w * 0.30)
    draw.rounded_rectangle([(w - hw) / 2, h - int(h * 0.012) - 5, (w + hw) / 2, h - int(h * 0.012)],
                            radius=3, fill=(200, 210, 216))
    return scene


OUT_BASE = "/Users/muhammedbozkurt/Desktop/Others/zerospike/zerospike-store/android-phone-1080x1920"
CANVAS = (1080, 1920)


def build_all(lang):
    from i18n_copy import WIDGET_STRINGS, frame_copy
    from PIL import Image
    OUT = os.path.join(OUT_BASE, lang)
    os.makedirs(OUT, exist_ok=True)
    BASE = dict(canvas=CANVAS, margin_x=54, headline_top=54, headline_size=70, sub_size=30,
                chip_size=27, text_w=int(CANVAS[0] * 0.80))
    headline, sub, chip_text = frame_copy(lang, "03-widget", platform="android")
    WS = WIDGET_STRINGS[lang]
    cfg = dict(BASE, headline=headline, sub=sub, lang=lang)

    DEV_Y = 388
    BEZEL = 13
    RADIUS = 52
    DEV_W = CANVAS[0] - 2 * BASE["margin_x"]
    SAFE_BOTTOM = CANVAS[1] - 20
    inner_w = DEV_W - 2 * BEZEL
    inner_h = SAFE_BOTTOM - DEV_Y - 2 * BEZEL

    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    f_chip = font(F_BOLD, cfg["chip_size"], lang=lang)
    chip_w, chip_h, *_ = measure_chip(probe, chip_text, f_chip, None)
    cfg["sub_max_lines"], chip_y, fits = fit_header_and_chip(cfg, chip_h, DEV_Y, 18, 6)
    if not fits:
        print(f"  WARN [{lang}] 03-widget chip overlaps the header band")

    canvas, draw, y_after = new_canvas_with_header(cfg)
    scene = lockscreen_scene_android(inner_w, inner_h, "9:41", WS["date"], 123, 72, S=WS, lang=lang)
    dev_x = (CANVAS[0] - DEV_W) // 2
    draw_device(canvas, scene, dev_x, DEV_Y, DEV_W, BEZEL, RADIUS)
    d2 = ImageDraw.Draw(canvas)
    cx = dev_x + DEV_W // 2
    cy = DEV_Y + BEZEL + 22
    r = 8
    d2.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(3, 3, 4))

    draw_chip_at(canvas, chip_text, CANVAS[0] - cfg["margin_x"] - chip_w, chip_y, f_chip, dot=(46, 230, 255))

    out_path = os.path.join(OUT, "03-widget.png")
    canvas.save(out_path)
    print("wrote", out_path, canvas.size)
    return [(out_path, CANVAS)]


def main(argv):
    from i18n_copy import LANGS
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
