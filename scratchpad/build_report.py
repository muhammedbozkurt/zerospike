#!/usr/bin/env python3
"""06-report: device-frameless A4 two-page collage (real seed-consistent data)."""
import sys, os, math, datetime
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image, ImageDraw, ImageFilter
from compose import (
    new_canvas_with_header, draw_chip_at, font, F_BOLD, measure_chip, hn,
    HN_BOLD, HN_MEDIUM, HN_REGULAR, fit_header_and_chip, fit_font, verify_output,
)
from i18n_copy import (
    REPORT_STRINGS, PROFILE_NAME, LANGS, frame_copy, pct, num, fmt_date,
)

INK = (20, 20, 20)
MUTED = (112, 112, 112)
ACCENT = (14, 116, 138)
LOW = (206, 58, 78)
TARGET_G = (28, 150, 102)
PAPER = (255, 255, 255)
PAPER_LINE = (228, 226, 219)


def soft_shadow_paste(canvas, x, y, w, h, radius, blur, alpha=90, grow=10):
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle([x - grow, y + grow * 0.6, x + w + grow, y + h + grow * 1.6], radius=radius, fill=(25, 22, 18, alpha))
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    out = Image.alpha_composite(canvas.convert("RGBA"), layer).convert("RGB")
    canvas.paste(out, (0, 0))


def draw_back_page(w, h, S=None, lang=None):
    if S is None:
        from i18n_copy import REPORT_STRINGS
        S = REPORT_STRINGS["tr"]
    page = Image.new("RGB", (w, h), (250, 249, 246))
    d = ImageDraw.Draw(page)
    pad = int(w * 0.06)
    inner = w - 2 * pad
    f_h = fit_font(d, S["back_title"], inner, int(h * 0.030), HN_BOLD, lang=lang)
    f_sub = fit_font(d, S["back_caption"], inner, int(h * 0.016), HN_REGULAR, lang=lang)
    f_date = hn(int(h * 0.018), HN_REGULAR)
    d.text((pad, int(h * 0.035)), S["back_title"], font=f_h, fill=INK)
    d.text((pad, int(h * 0.035) + int(h * 0.036)), S["back_caption"],
           font=f_sub, fill=MUTED)
    d.line([(pad, int(h * 0.11)), (w - pad, int(h * 0.11))], fill=PAPER_LINE, width=2)

    rows = 16
    row_h = (h - int(h * 0.14)) / rows
    day0 = datetime.date(2026, 7, 24)
    dots = [1, 3, 5, 7, 9, 11, 13]
    for i in range(rows):
        y = int(h * 0.13) + i * row_h
        dstr = fmt_date(day0 - datetime.timedelta(days=i), lang)
        d.text((pad, y), dstr, font=f_date, fill=MUTED)
        if i in dots:
            cx = pad + int(w * 0.24)
            r = max(4, int(h * 0.0062))
            color = (222, 158, 46) if i % 5 else TARGET_G
            d.ellipse([cx - r, y + r, cx + r, y + 3 * r], fill=color)
    return page


def stat_box(draw, x, y, w, h, value, label, accent, lang=None):
    draw.rounded_rectangle([x, y, x + w, y + h], radius=int(h * 0.14), outline=(232, 230, 224), width=2, fill=PAPER)
    draw.rounded_rectangle([x, y, x + max(5, int(w * 0.018)), y + h], radius=int(h * 0.03), fill=accent)
    pad = int(w * 0.11)
    inner = w - int(pad * 1.6)
    # the value is digits + a percent sign, so it stays on Helvetica Neue; only
    # the label is a translation and only the label can outgrow the box
    f_val = fit_font(draw, value, inner, int(h * 0.40), HN_BOLD)
    f_lbl = fit_font(draw, label, inner, int(h * 0.175), HN_REGULAR, lang=lang)
    draw.text((x + pad, y + int(h * 0.14)), value, font=f_val, fill=INK)
    draw.text((x + pad, y + int(h * 0.66)), label, font=f_lbl, fill=MUTED)


def draw_front_page(w, h, data, S=None, lang=None):
    """Fewer, bigger elements - legible at store-thumbnail scale, not a crammed
    print-density report. Hero stats + AGP only; the exhaustive table a real
    export would have is not what a MARKETING screenshot needs."""
    if S is None:
        from i18n_copy import REPORT_STRINGS
        S = REPORT_STRINGS["tr"]
    page = Image.new("RGB", (w, h), PAPER)
    d = ImageDraw.Draw(page)
    pad = int(w * 0.06)
    inner = w - 2 * pad
    f_brand = hn(int(h * 0.020), HN_BOLD)
    f_axis = hn(int(h * 0.0145), HN_REGULAR)

    meta1 = f"{S['profile_label']}: {data['profile']}"
    meta2 = f"{S['range_label']}: {data['range']}"
    meta_w = inner * 0.62
    f_meta = fit_font(d, max(meta1, meta2, key=len), meta_w, int(h * 0.0155), HN_REGULAR, lang=lang)
    f_title = fit_font(d, S["title"], inner * 0.62, int(h * 0.038), HN_BOLD, lang=lang)
    f_sec = fit_font(d, max(S["summary"], S["agp_title"], key=len), inner, int(h * 0.021), HN_BOLD, lang=lang)
    f_small = fit_font(
        d,
        max(S["band_fmt"].format(**data), S["agp_caption_fmt"].format(**data),
            S["footer_fmt"].format(**data), key=len),
        inner, int(h * 0.0145), HN_REGULAR, lang=lang,
    )

    d.text((pad, int(h * 0.030)), "zerospike", font=f_brand, fill=ACCENT)
    d.text((w - pad - d.textlength(meta1, font=f_meta), int(h * 0.027)), meta1, font=f_meta, fill=MUTED)
    d.text((w - pad - d.textlength(meta2, font=f_meta), int(h * 0.027) + int(h * 0.020)), meta2, font=f_meta, fill=MUTED)

    d.text((pad, int(h * 0.065)), S["title"], font=f_title, fill=INK)
    y = int(h * 0.125)
    d.line([(pad, y), (w - pad, y)], fill=(35, 35, 35), width=3)

    y += int(h * 0.028)
    d.text((pad, y), S["summary"], font=f_sec, fill=INK)
    y += int(h * 0.036)
    bw = (w - 2 * pad - 2 * int(w * 0.025)) / 3
    bh = int(h * 0.115)
    boxes = [
        (f"{data['avg']}", S["avg_label"], ACCENT),
        (data["gmi_pct"], S["gmi_label"], ACCENT),
        (data["tir_pct"], S["inrange_label"], TARGET_G),
    ]
    for i, (val, lbl, ac) in enumerate(boxes):
        bx = pad + i * (bw + int(w * 0.025))
        stat_box(d, bx, y, bw, bh, val, lbl, ac, lang=lang)
    y += bh + int(h * 0.030)

    band_txt = S["band_fmt"].format(**data)
    d.text((pad, y), band_txt, font=f_small, fill=MUTED)
    y += int(h * 0.045)

    d.text((pad, y), S["agp_title"], font=f_sec, fill=INK)
    y += int(h * 0.04)
    chart_h = int(h * 0.27)
    chart_x0, chart_x1 = pad, w - pad
    chart_y0, chart_y1 = y, y + chart_h
    for lbl, frac in [("300", 0.0), ("160", 0.62), ("80", 0.86)]:
        yy = chart_y0 + frac * chart_h
        d.line([(chart_x0, yy), (chart_x1, yy)], fill=(240, 238, 232), width=1)
        d.text((chart_x0 - int(w * 0.014) - d.textlength(lbl, font=f_axis), yy - int(h * 0.010)), lbl, font=f_axis, fill=MUTED)

    n = 24
    pts_mid, pts_lo, pts_hi = [], [], []
    for i in range(n + 1):
        t = i / n
        base = 115 + 35 * math.sin(t * math.pi * 2 - 1.0) + (25 if 0.55 < t < 0.85 else 0)
        mid = max(80, min(220, base))
        frac = 1 - (mid - 40) / (300 - 40)
        xx = chart_x0 + t * (chart_x1 - chart_x0)
        pts_mid.append((xx, chart_y0 + frac * chart_h))
        pts_lo.append((xx, chart_y0 + min(1, frac + 0.07) * chart_h))
        pts_hi.append((xx, chart_y0 + max(0, frac - 0.07) * chart_h))
    band = pts_hi + pts_lo[::-1]
    d.polygon(band, fill=(211, 235, 233))
    d.line(pts_mid, fill=ACCENT, width=max(3, int(h * 0.006)), joint="curve")
    for i in range(0, n + 1, n // 4):
        xx = pts_mid[i][0]
        lbl = f"{i}:00"
        d.text((xx - d.textlength(lbl, font=f_axis) / 2, chart_y1 + int(h * 0.012)), lbl, font=f_axis, fill=MUTED)
    y = chart_y1 + int(h * 0.05)
    d.text((pad, y), S["agp_caption_fmt"].format(**data), font=f_small, fill=MUTED)
    y += int(h * 0.05)

    footer = S["footer_fmt"].format(**data)
    d.line([(pad, y), (w - pad, y)], fill=(240, 238, 232), width=1)
    d.text((pad, y + int(h * 0.018)), footer, font=f_small, fill=INK)
    return page


RANGE_START = datetime.date(2026, 6, 24)
RANGE_END = datetime.date(2026, 7, 24)


def report_data(lang, avg=123, gmi=6.3, tir=74, n=126, median=113):
    """The one seed-consistent dataset every canvas draws, with the numbers
    already written in the target language's own conventions: Turkish "%74",
    German "74 %", English "74%" (lib/format.pct), and the decimal comma /
    date order the app's Intl calls would produce."""
    return dict(
        profile=PROFILE_NAME[lang],
        range=f"{fmt_date(RANGE_START, lang)} - {fmt_date(RANGE_END, lang)}",
        avg=avg, tir=tir, n=n, hours=8, median=median, inj=32,
        gmi_pct=pct(gmi, lang, 1), tir_pct=pct(tir, lang),
        lowp_pct=pct(6, lang), high_pct=pct(20, lang),
        dose=num(11.8, lang, 1),
    )


OUT_BASE = "/Users/muhammedbozkurt/Desktop/Others/zerospike/zerospike-store/iphone-1284x2778"
CANVAS = (1284, 2778)


def build_all(lang):
    OUT = os.path.join(OUT_BASE, lang)
    os.makedirs(OUT, exist_ok=True)
    BASE = dict(canvas=CANVAS, margin_x=64, headline_top=64, headline_size=84, sub_size=36,
                chip_size=32, text_w=int(CANVAS[0] * 0.80))
    headline, sub, chip_text = frame_copy(lang, "06-report")
    S = REPORT_STRINGS[lang]
    cfg = dict(BASE, headline=headline, sub=sub, lang=lang)

    page_w = int(CANVAS[0] * 0.70)
    page_h = int(page_w / 0.707)
    front_x = int(CANVAS[0] * 0.065)
    front_y = 940
    back_x = front_x + int(page_w * 0.28)
    back_y = front_y - int(page_h * 0.065)

    # no device here, so the chip's floor is the topmost sheet of paper
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    f_chip = font(F_BOLD, cfg["chip_size"], lang=lang)
    chip_w, chip_h, *_ = measure_chip(probe, chip_text, f_chip, "📄")
    cfg["sub_max_lines"], chip_y, fits = fit_header_and_chip(cfg, chip_h, back_y, 26, 8)
    if not fits:
        print(f"  WARN [{lang}] 06-report chip overlaps the header band")

    canvas, draw, y_after = new_canvas_with_header(cfg)
    draw_chip_at(canvas, chip_text, CANVAS[0] - cfg["margin_x"] - chip_w, chip_y, f_chip, emoji_ch="📄")

    soft_shadow_paste(canvas, back_x, back_y, page_w, page_h, radius=6, blur=26, alpha=70, grow=14)
    canvas.paste(draw_back_page(page_w, page_h, S=S, lang=lang), (back_x, back_y))

    soft_shadow_paste(canvas, front_x, front_y, page_w, page_h, radius=6, blur=34, alpha=100, grow=18)
    canvas.paste(draw_front_page(page_w, page_h, report_data(lang), S=S, lang=lang), (front_x, front_y))

    out_path = os.path.join(OUT, "06-report.png")
    canvas.save(out_path)
    print("wrote", out_path, canvas.size, "page", page_w, page_h, "aspect_wh", round(page_w / page_h, 3))
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
