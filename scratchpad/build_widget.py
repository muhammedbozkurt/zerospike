#!/usr/bin/env python3
"""03-widget: synthetic lock-screen scene (not a device capture) composited
into the same cream-panel + device-bezel language as the other frames."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image, ImageDraw, ImageFont
from compose import (
    new_canvas_with_header, draw_chip_at, draw_device, font, F_BOLD, measure_chip,
    hn, HN_BOLD, HN_MEDIUM, HN_ULTRALIGHT, HN_REGULAR, vertical_gradient,
    fit_header_and_chip, fit_font, verify_output, align_for,
)
from i18n_copy import FRAME_COPY, WIDGET_STRINGS, LANGS, frame_copy

THEME_G1 = (7, 13, 19)
THEME_G2 = (16, 34, 44)
ACCENT = (46, 230, 255)
TARGET = (34, 227, 154)
INK = (234, 246, 250)
MUTED = (146, 170, 182)


def lockscreen_scene(w, h, time_str, date_str, avg_value, timer_min, S=None, lang=None):
    """`lang` routes only the TRANSLATED labels to a face that has their glyphs.
    The clock, the reading and the countdown are digits, and keeping them on
    Helvetica Neue is what preserves the iOS lock-screen look in ja/ar too."""
    if S is None:
        from i18n_copy import WIDGET_STRINGS
        S = WIDGET_STRINGS["tr"]
    scene = vertical_gradient((w, h), THEME_G2, THEME_G1)
    draw = ImageDraw.Draw(scene)

    # clock: authentic iOS lock-screen weight (ultralight) with tight tracking
    f_clock = hn(int(w * 0.30), HN_ULTRALIGHT)
    clock_top = int(h * 0.09)
    cw = draw.textlength(time_str, font=f_clock)
    cbbox = draw.textbbox((0, clock_top), time_str, font=f_clock)
    draw.text(((w - cw) / 2, clock_top), time_str, font=f_clock, fill=(255, 255, 255))

    f_date = fit_font(draw, date_str, int(w * 0.86), int(w * 0.044), HN_MEDIUM, lang=lang)
    dw = draw.textlength(date_str, font=f_date)
    date_top = cbbox[3] + int(h * 0.02)
    draw.text(((w - dw) / 2, date_top), date_str, font=f_date, fill=MUTED)

    # home-screen widget card (ORT. GLUKOZ) — soft card with faint top inset line
    card_x0, card_y0 = int(w * 0.09), int(h * 0.395)
    card_w, card_h = int(w * 0.42), int(w * 0.42)
    card = vertical_gradient((card_w, card_h), (22, 35, 44), (14, 24, 31))
    mask = Image.new("L", (card_w, card_h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, card_w - 1, card_h - 1], radius=int(w * 0.06), fill=255)
    scene.paste(card, (card_x0, card_y0), mask)
    ImageDraw.Draw(scene).rounded_rectangle(
        [card_x0, card_y0, card_x0 + card_w, card_y0 + card_h], radius=int(w * 0.06),
        outline=(255, 255, 255, 30), width=1,
    )
    pad = int(w * 0.045)
    inner = card_w - 2 * pad
    f_lbl = fit_font(draw, S["avg_glucose"], inner, int(w * 0.026), HN_BOLD, lang=lang)
    f_val = hn(int(w * 0.10), HN_BOLD)
    f_unit = hn(int(w * 0.028), HN_REGULAR)
    f_sub = fit_font(draw, S["last7"], inner - int(w * 0.028), int(w * 0.028), HN_REGULAR, lang=lang)
    draw.text((card_x0 + pad, card_y0 + pad), S["avg_glucose"], font=f_lbl, fill=MUTED)
    draw.text((card_x0 + pad, card_y0 + pad + int(w * 0.05)), str(avg_value), font=f_val, fill=TARGET)
    vw = draw.textlength(str(avg_value), font=f_val)
    draw.text((card_x0 + pad + vw + 8, card_y0 + pad + int(w * 0.05) + int(w * 0.062)), "mg/dL", font=f_unit, fill=MUTED)
    dot_y = card_y0 + card_h - pad - int(w * 0.028)
    draw.ellipse([card_x0 + pad, dot_y, card_x0 + pad + int(w * 0.018), dot_y + int(w * 0.018)], fill=TARGET)
    draw.text((card_x0 + pad + int(w * 0.028), dot_y - int(w * 0.007)), S["last7"], font=f_sub, fill=TARGET)

    # Live Activity card
    la_x0, la_y0 = int(w * 0.09), int(h * 0.395) + card_h + int(h * 0.024)
    la_w, la_h = w - 2 * la_x0, int(h * 0.118)
    la_card = vertical_gradient((la_w, la_h), (20, 32, 40), (12, 21, 27))
    lam = Image.new("L", (la_w, la_h), 0)
    ImageDraw.Draw(lam).rounded_rectangle([0, 0, la_w - 1, la_h - 1], radius=int(w * 0.06), fill=255)
    scene.paste(la_card, (la_x0, la_y0), lam)

    icon_size = int(la_h * 0.60)
    icon_x, icon_y = la_x0 + int(w * 0.032), la_y0 + (la_h - icon_size) // 2
    icon_grad = vertical_gradient((icon_size, icon_size), (127, 244, 255), (46, 230, 255))
    imask = Image.new("L", (icon_size, icon_size), 0)
    ImageDraw.Draw(imask).rounded_rectangle([0, 0, icon_size - 1, icon_size - 1], radius=int(icon_size * 0.28), fill=255)
    scene.paste(icon_grad, (icon_x, icon_y), imask)
    pts = []
    px, py = icon_x + icon_size * 0.16, icon_y + icon_size * 0.55
    pulse = [(0, 0), (0.16, 0), (0.26, -0.30), (0.38, 0.34), (0.48, 0), (0.70, 0)]
    for dx, dy in pulse:
        pts.append((px + dx * icon_size, py + dy * icon_size))
    draw.line(pts, fill=(3, 24, 28), width=max(3, icon_size // 13), joint="curve")

    f_app = hn(int(w * 0.028), HN_BOLD)
    tx = icon_x + icon_size + int(w * 0.03)

    f_timerN = hn(int(w * 0.058), HN_BOLD)
    f_timerU = hn(int(w * 0.024), HN_REGULAR, lang=lang)
    tstr = str(timer_min)
    tw = max(draw.textlength(tstr, font=f_timerN), draw.textlength(S["min_unit"], font=f_timerU))
    right = la_x0 + la_w - int(w * 0.032)

    # the title shares the row with the countdown, so it is measured against the
    # gap that is actually left - "Blutzucker nach dem Essen" is three times the
    # width of "Tokluk Sekeri" in the same slot
    f_title = fit_font(draw, S["timer_title"], (right - tw) - tx - int(w * 0.02),
                       int(w * 0.040), HN_BOLD, lang=lang)
    draw.text((tx, la_y0 + la_h * 0.17), "zerospike", font=f_app, fill=ACCENT)
    draw.text((tx, la_y0 + la_h * 0.47), S["timer_title"], font=f_title, fill=INK)

    draw.text((right - draw.textlength(tstr, font=f_timerN), la_y0 + la_h * 0.15), tstr, font=f_timerN, fill=ACCENT)
    draw.text((right - draw.textlength(S["min_unit"], font=f_timerU), la_y0 + la_h * 0.63),
              S["min_unit"], font=f_timerU, fill=MUTED)

    bar_y = la_y0 + la_h + int(h * 0.018)
    bar_h = max(4, int(w * 0.012))
    bar_x0, bar_x1 = la_x0 + int(w * 0.032), la_x0 + la_w - int(w * 0.032)
    draw.rounded_rectangle([bar_x0, bar_y, bar_x1, bar_y + bar_h], radius=bar_h // 2, fill=(28, 42, 50))
    frac = 0.30
    draw.rounded_rectangle(
        [bar_x0, bar_y, bar_x0 + int((bar_x1 - bar_x0) * frac), bar_y + bar_h], radius=bar_h // 2, fill=ACCENT
    )

    hw = int(w * 0.32)
    draw.rounded_rectangle(
        [(w - hw) / 2, h - int(h * 0.014) - 6, (w + hw) / 2, h - int(h * 0.014)], radius=3, fill=(200, 210, 216)
    )
    return scene


OUT_BASE = "/Users/muhammedbozkurt/Desktop/Others/zerospike/zerospike-store/iphone-1284x2778"
CANVAS = (1284, 2778)


def build_all(lang):
    OUT = os.path.join(OUT_BASE, lang)
    os.makedirs(OUT, exist_ok=True)
    BASE = dict(
        canvas=CANVAS, margin_x=64, headline_top=64, headline_size=84, sub_size=36,
        chip_size=32, text_w=int(CANVAS[0] * 0.80),
    )
    headline, sub, chip_text = frame_copy(lang, "03-widget")
    S = WIDGET_STRINGS[lang]
    cfg = dict(BASE, headline=headline, sub=sub, lang=lang, align=align_for(lang))

    DEV_Y = 460
    DEV_X = 64
    DEV_W = CANVAS[0] - 2 * DEV_X
    BEZEL = 16
    RADIUS = 64
    SAFE_BOTTOM = CANVAS[1] - 24
    inner_w = DEV_W - 2 * BEZEL
    inner_h = SAFE_BOTTOM - DEV_Y - 2 * BEZEL

    # spec 3: the chip lives on the cream band only and may never touch the
    # bezel, so the subtitle line budget and the chip y are solved together
    from PIL import ImageDraw, Image
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    f_chip = font(F_BOLD, cfg["chip_size"], lang=lang)
    chip_w, chip_h, *_ = measure_chip(probe, chip_text, f_chip, None)
    cfg["sub_max_lines"], chip_y, fits = fit_header_and_chip(cfg, chip_h, DEV_Y, 26, 8)
    if not fits:
        print(f"  WARN [{lang}] 03-widget chip overlaps the header band")

    canvas, draw, y_after = new_canvas_with_header(cfg)
    scene = lockscreen_scene(inner_w, inner_h, "09:41", S["date"], 123, 72, S=S, lang=lang)
    draw_device(canvas, scene, DEV_X, DEV_Y, DEV_W, BEZEL, RADIUS)
    chip_x = (CANVAS[0] - chip_w) // 2 if cfg["align"] == "center" else CANVAS[0] - cfg["margin_x"] - chip_w
    draw_chip_at(canvas, chip_text, chip_x, chip_y, f_chip, dot=(46, 230, 255))

    out_path = os.path.join(OUT, "03-widget.png")
    canvas.save(out_path)
    print("wrote", out_path, canvas.size)
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
