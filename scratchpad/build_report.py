#!/usr/bin/env python3
"""06-report: device-frameless A4 two-page collage (real seed-consistent data)."""
import sys, os, math, datetime
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image, ImageDraw, ImageFilter
from compose import new_canvas_with_header, draw_chip_at, font, F_BOLD, measure_chip, hn, HN_BOLD, HN_MEDIUM, HN_REGULAR
from i18n_copy import FRAME_COPY, REPORT_STRINGS, PROFILE_NAME

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


def draw_back_page(w, h, S=None):
    if S is None:
        from i18n_copy import REPORT_STRINGS
        S = REPORT_STRINGS["tr"]
    page = Image.new("RGB", (w, h), (250, 249, 246))
    d = ImageDraw.Draw(page)
    f_h = hn(int(h * 0.030), HN_BOLD)
    f_sub = hn(int(h * 0.016), HN_REGULAR)
    f_date = hn(int(h * 0.018), HN_REGULAR)
    pad = int(w * 0.06)
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
        dstr = (day0 - datetime.timedelta(days=i)).strftime("%d.%m.%Y")
        d.text((pad, y), dstr, font=f_date, fill=MUTED)
        if i in dots:
            cx = pad + int(w * 0.24)
            r = max(4, int(h * 0.0062))
            color = (222, 158, 46) if i % 5 else TARGET_G
            d.ellipse([cx - r, y + r, cx + r, y + 3 * r], fill=color)
    return page


def stat_box(draw, x, y, w, h, value, label, accent):
    draw.rounded_rectangle([x, y, x + w, y + h], radius=int(h * 0.14), outline=(232, 230, 224), width=2, fill=PAPER)
    draw.rounded_rectangle([x, y, x + max(5, int(w * 0.018)), y + h], radius=int(h * 0.03), fill=accent)
    f_val = hn(int(h * 0.40), HN_BOLD)
    f_lbl = hn(int(h * 0.175), HN_REGULAR)
    pad = int(w * 0.11)
    draw.text((x + pad, y + int(h * 0.14)), value, font=f_val, fill=INK)
    draw.text((x + pad, y + int(h * 0.66)), label, font=f_lbl, fill=MUTED)


def draw_front_page(w, h, data, S=None):
    """Fewer, bigger elements - legible at store-thumbnail scale, not a crammed
    print-density report. Hero stats + AGP only; the exhaustive table a real
    export would have is not what a MARKETING screenshot needs."""
    if S is None:
        from i18n_copy import REPORT_STRINGS
        S = REPORT_STRINGS["tr"]
    page = Image.new("RGB", (w, h), PAPER)
    d = ImageDraw.Draw(page)
    pad = int(w * 0.06)
    f_brand = hn(int(h * 0.020), HN_BOLD)
    f_title = hn(int(h * 0.038), HN_BOLD)
    f_meta = hn(int(h * 0.0155), HN_REGULAR)
    f_sec = hn(int(h * 0.021), HN_BOLD)
    f_small = hn(int(h * 0.0145), HN_REGULAR)

    d.text((pad, int(h * 0.030)), "zerospike", font=f_brand, fill=ACCENT)
    meta1 = f"{S['profile_label']}: {data['profile']}"
    d.text((w - pad - d.textlength(meta1, font=f_meta), int(h * 0.027)), meta1, font=f_meta, fill=MUTED)
    meta2 = f"{S['range_label']}: {data['range']}"
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
        (f"{data['gmi']}%", S["gmi_label"], ACCENT),
        (f"{data['tir']}%", S["inrange_label"], TARGET_G),
    ]
    for i, (val, lbl, ac) in enumerate(boxes):
        bx = pad + i * (bw + int(w * 0.025))
        stat_box(d, bx, y, bw, bh, val, lbl, ac)
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
        d.text((chart_x0 - int(w * 0.014) - d.textlength(lbl, font=f_small), yy - int(h * 0.010)), lbl, font=f_small, fill=MUTED)

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
        d.text((xx - d.textlength(lbl, font=f_small) / 2, chart_y1 + int(h * 0.012)), lbl, font=f_small, fill=MUTED)
    y = chart_y1 + int(h * 0.05)
    d.text((pad, y), S["agp_caption_fmt"].format(**data), font=f_small, fill=MUTED)
    y += int(h * 0.05)

    footer = S["footer_fmt"].format(**data)
    d.line([(pad, y), (w - pad, y)], fill=(240, 238, 232), width=1)
    d.text((pad, y + int(h * 0.018)), footer, font=f_small, fill=INK)
    return page


def build_all(lang):
    OUT = f"/Users/muhammedbozkurt/Desktop/Others/zerospike/zerospike-store-r93/iphone-1284x2778/{lang}"
    os.makedirs(OUT, exist_ok=True)
    CANVAS = (1284, 2778)
    BASE = dict(canvas=CANVAS, margin_x=64, headline_top=64, headline_size=84, sub_size=36,
                chip_size=32, text_w=int(CANVAS[0] * 0.80))
    headline, sub, chip_text = FRAME_COPY[lang]["06-report"]
    S = REPORT_STRINGS[lang]
    cfg = dict(BASE, headline=headline, sub=sub)
    canvas, draw, y_after = new_canvas_with_header(cfg)

    f_chip = font(F_BOLD, cfg["chip_size"])
    w_, h_, *_ = measure_chip(draw, chip_text, f_chip, "📄")
    x_ = CANVAS[0] - cfg["margin_x"] - w_
    draw_chip_at(canvas, chip_text, x_, y_after + 26, f_chip, emoji_ch="📄")

    page_w = int(CANVAS[0] * 0.70)
    page_h = int(page_w / 0.707)
    front_x = int(CANVAS[0] * 0.065)
    front_y = 940
    back_x = front_x + int(page_w * 0.28)
    back_y = front_y - int(page_h * 0.065)

    soft_shadow_paste(canvas, back_x, back_y, page_w, page_h, radius=6, blur=26, alpha=70, grow=14)
    back = draw_back_page(page_w, page_h, S=S)
    canvas.paste(back, (back_x, back_y))

    data = dict(profile=PROFILE_NAME[lang], range="24.06.2026 - 24.07.2026", created="24.07.2026 23:26",
                avg=123, gmi="6.3", tir=74, sd=33, cv=27, low=11, vlow=0, lowp=6, high=20, vhigh=0,
                n=126, hours=8, median=113, dose="11,8", inj=32)
    soft_shadow_paste(canvas, front_x, front_y, page_w, page_h, radius=6, blur=34, alpha=100, grow=18)
    front = draw_front_page(page_w, page_h, data, S=S)
    canvas.paste(front, (front_x, front_y))

    canvas.save(os.path.join(OUT, "06-report.png"))
    print("wrote 06-report", canvas.size, "page", page_w, page_h, "aspect_wh", round(page_w / page_h, 3))


if __name__ == "__main__":
    lang = sys.argv[1] if len(sys.argv) > 1 else "tr"
    build_all(lang)
