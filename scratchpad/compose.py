#!/usr/bin/env python3
"""R9.3 store-shot compositor v2: cream panel + device bezel (real capture inside)
+ headline/subtitle + up to 2 chips. Pure PIL, no browser dependency.

v2 fixes a first-pass "programmer art" look: Arial Black -> Helvetica Neue with
manual tracking, dot placeholders -> real emoji glyphs, flat bezel -> bezel with
a soft ambient shadow + subtle gradient + rim highlight.
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HN = "/System/Library/Fonts/HelveticaNeue.ttc"
# face indices inside the collection (verified via fontTools)
HN_REGULAR, HN_BOLD, HN_ITALIC, HN_BOLDITALIC, HN_COND_BOLD = 0, 1, 2, 3, 4
HN_ULTRALIGHT, HN_LIGHT = 5, 7
HN_MEDIUM = 10
EMOJI_FONT = "/System/Library/Fonts/Apple Color Emoji.ttc"
EMOJI_STRIKES = [20, 32, 40, 48, 64, 96, 160]

# kept for any caller still importing the old names
FONT_DIR = "/System/Library/Fonts/Supplemental"
F_BLACK = os.path.join(FONT_DIR, "Arial Black.ttf")
F_BOLD = os.path.join(FONT_DIR, "Arial Bold.ttf")
F_REG = os.path.join(FONT_DIR, "Arial.ttf")

CREAM = (237, 235, 229)
INK = (23, 23, 23)
MUTED = (104, 104, 104)
DEVICE_BEZEL_TOP = (26, 27, 30)
DEVICE_BEZEL_BOTTOM = (6, 6, 8)


def hn(size, index=HN_REGULAR):
    return ImageFont.truetype(HN, size, index=index)


def font(path_or_none, size, index=HN_REGULAR):
    """Back-compat shim: old call sites pass an Arial .ttf path; new code should
    pass index=HN_*. If given one of the old Arial paths, map it to a sane HN
    equivalent so nothing breaks."""
    if path_or_none == F_BLACK:
        return hn(size, HN_BOLD)
    if path_or_none == F_BOLD:
        return hn(size, HN_BOLD)
    if path_or_none == F_REG:
        return hn(size, HN_REGULAR)
    return hn(size, index)


def emoji_img(ch, target_px):
    best = EMOJI_STRIKES[-1]
    for s in EMOJI_STRIKES:
        if s >= target_px:
            best = s
            break
    f = ImageFont.truetype(EMOJI_FONT, best)
    canvas = Image.new("RGBA", (best * 2, best * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(canvas)
    d.text((best // 2, best // 2), ch, font=f, embedded_color=True)
    bbox = canvas.getbbox()
    if bbox:
        canvas = canvas.crop(bbox)
    scale = target_px / canvas.height
    w = max(1, int(canvas.width * scale))
    return canvas.resize((w, target_px), Image.LANCZOS)


def text_tracked_width(draw, text, f, tracking=0):
    if not text:
        return 0
    total = 0
    for ch in text:
        total += draw.textlength(ch, font=f) + tracking
    return total - tracking


def draw_text_tracked(draw, xy, text, f, fill, tracking=0):
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=f, fill=fill)
        x += draw.textlength(ch, font=f) + tracking
    return x


def wrap_text_tracked(draw, text, f, max_w, tracking=0, max_lines=2):
    words = text.split()
    lines, cur = [], ""
    for wd in words:
        trial = (cur + " " + wd).strip()
        if text_tracked_width(draw, trial, f, tracking) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = wd
            if len(lines) >= max_lines:
                break
    if cur and len(lines) < max_lines:
        lines.append(cur)
    return lines[:max_lines]


# ---- back-compat plain wrappers (no tracking) ----
def wrap_text(draw, text, f, max_w, max_lines=2):
    return wrap_text_tracked(draw, text, f, max_w, tracking=0, max_lines=max_lines)


def rounded_mask(size, radius):
    m = Image.new("L", size, 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=255)
    return m


def paste_rounded(base, img, pos, radius):
    mask = rounded_mask(img.size, radius)
    base.paste(img, pos, mask)


def load_cropped_shot(path, crop_top, crop_bottom):
    shot = Image.open(path).convert("RGB")
    sw, sh = shot.size
    cb = crop_bottom if crop_bottom is not None else sh
    return shot.crop((0, crop_top, sw, cb))


def vertical_gradient(size, top, bottom):
    w, h = size
    grad = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / max(1, h - 1)
        grad.putpixel((0, y), tuple(int(top[i] * (1 - t) + bottom[i] * t) for i in range(3)))
    return grad.resize((w, h))


def draw_device(canvas, shot_img, dev_x, dev_y, dev_w, bezel, radius_outer):
    """Bezel sized to the shot's own aspect (width-matched). Adds a soft ambient
    shadow, a subtle top->bottom bezel gradient, and a 1px top rim highlight so
    it reads as a physical object instead of a flat rounded rectangle."""
    inner_w = dev_w - 2 * bezel
    scale = inner_w / shot_img.size[0]
    inner_h = max(1, round(shot_img.size[1] * scale))
    dev_h = inner_h + 2 * bezel

    # ambient shadow: a blurred dark rounded-rect sitting slightly below the device
    pad = int(dev_w * 0.06)
    shadow_layer = Image.new("RGBA", (canvas.width, canvas.height), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow_layer)
    sd.rounded_rectangle(
        [dev_x - pad // 3, dev_y + int(dev_h * 0.02), dev_x + dev_w + pad // 3, dev_y + dev_h + pad],
        radius=radius_outer, fill=(20, 18, 15, 95),
    )
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(pad * 0.55))
    canvas.paste(Image.alpha_composite(canvas.convert("RGBA"), shadow_layer).convert("RGB"), (0, 0))

    draw = ImageDraw.Draw(canvas)
    bezel_grad = vertical_gradient((dev_w, dev_h), DEVICE_BEZEL_TOP, DEVICE_BEZEL_BOTTOM)
    mask = rounded_mask((dev_w, dev_h), radius_outer)
    canvas.paste(bezel_grad, (dev_x, dev_y), mask)

    # 1px rim highlight along the top edge (reads as a light catching a metal edge)
    rim = Image.new("RGBA", (dev_w, dev_h), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rim)
    rd.rounded_rectangle([0, 0, dev_w - 1, dev_h - 1], radius=radius_outer, outline=(255, 255, 255, 40), width=2)
    canvas.paste(Image.alpha_composite(canvas.convert("RGBA"), Image.new("RGBA", canvas.size, (0, 0, 0, 0))).convert("RGB"), (0, 0))
    canvas_rgba = canvas.convert("RGBA")
    canvas_rgba.alpha_composite(rim, (dev_x, dev_y))
    canvas.paste(canvas_rgba.convert("RGB"), (0, 0))

    inner_x = dev_x + bezel
    inner_y = dev_y + bezel
    shot = shot_img.resize((inner_w, inner_h), Image.LANCZOS)
    paste_rounded(canvas, shot, (inner_x, inner_y), radius=max(0, radius_outer - bezel))
    return (dev_x, dev_y, dev_w, dev_h)


def measure_chip(draw, text, f_chip, emoji_ch=None, chip_h_px=None):
    pad_x, pad_y = 28, 16
    tw = draw.textlength(text, font=f_chip)
    th = f_chip.size
    h = int(th + pad_y * 2 + 6)
    e_size = int(h * 0.52)
    extra = (e_size + 14) if emoji_ch else 0
    w = int(tw + pad_x * 2 + extra)
    return w, h, pad_x, pad_y, extra


def draw_chip_at(canvas, text, x, y, f_chip, emoji_ch=None, dot=None):
    draw = ImageDraw.Draw(canvas)
    w, h, pad_x, pad_y, extra = measure_chip(draw, text, f_chip, emoji_ch)
    # soft chip shadow
    shadow = Image.new("RGBA", (w + 40, h + 40), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle([20, 24, 20 + w, 24 + h], radius=h // 2, fill=(20, 18, 15, 70))
    shadow = shadow.filter(ImageFilter.GaussianBlur(8))
    canvas_rgba = canvas.convert("RGBA")
    canvas_rgba.alpha_composite(shadow, (x - 20, y - 20))
    canvas.paste(canvas_rgba.convert("RGB"), (0, 0))

    draw.rounded_rectangle([x, y, x + w, y + h], radius=h // 2, fill=(255, 255, 255))
    tx = x + pad_x
    if emoji_ch:
        e_size = int(h * 0.52)
        eimg = emoji_img(emoji_ch, e_size)
        ey = y + (h - eimg.height) // 2
        canvas_rgba = canvas.convert("RGBA")
        canvas_rgba.alpha_composite(eimg, (tx, ey))
        canvas.paste(canvas_rgba.convert("RGB"), (0, 0))
        tx += e_size + 14
    elif dot:
        r = 6
        draw.ellipse([tx, y + h // 2 - r, tx + 2 * r, y + h // 2 + r], fill=dot)
        tx += 2 * r + 12
    draw.text((tx, y + pad_y - 1), text, font=f_chip, fill=(24, 24, 24))
    return (x, y, w, h)


def new_canvas_with_header(cfg):
    """Draws cream bg + tracked headline + subtitle. Returns (canvas, draw, y_after_text)."""
    W, H = cfg["canvas"]
    canvas = Image.new("RGB", (W, H), CREAM)
    draw = ImageDraw.Draw(canvas)

    margin_x = cfg["margin_x"]
    max_text_w = cfg.get("text_w", int(W * 0.80))
    f_head = hn(cfg["headline_size"], HN_BOLD)
    f_sub = hn(cfg["sub_size"], HN_REGULAR)
    tracking = cfg.get("headline_tracking", -cfg["headline_size"] * 0.012)

    lines = wrap_text_tracked(draw, cfg["headline"], f_head, max_text_w, tracking=tracking, max_lines=2)
    y = cfg["headline_top"]
    line_h = int(cfg["headline_size"] * 1.08)
    for ln in lines:
        draw_text_tracked(draw, (margin_x, y), ln, f_head, INK, tracking=tracking)
        y += line_h
    y += int(cfg["headline_size"] * 0.20)
    sub_lines = wrap_text(draw, cfg["sub"], f_sub, max_text_w, max_lines=3)
    sub_line_h = int(cfg["sub_size"] * 1.42)
    for ln in sub_lines:
        draw.text((margin_x, y), ln, font=f_sub, fill=MUTED)
        y += sub_line_h

    return canvas, draw, y
