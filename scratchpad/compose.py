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

# Helvetica Neue carries no Arabic and no CJK glyphs (verified against the
# 2.0.0 copy with fontTools: every ar/ja codepoint misses), so those two
# languages need their own faces or the panels render as tofu boxes.
HIRAGINO_W6 = "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc"
HIRAGINO_W3 = "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc"
# (face, ttc index) for the bold and regular weight of each non-Latin language
LANG_FACES = {
    "ja": {"bold": (HIRAGINO_W6, 0), "regular": (HIRAGINO_W3, 0)},
    "ar": {"bold": (F_BOLD, 0), "regular": (F_REG, 0)},
}
# Languages whose glyphs must be handed to the shaper as whole runs. Manual
# per-character tracking would disable Arabic joining and bidi reordering, and
# spreads CJK apart; both are drawn with a single draw.text call instead.
SHAPED_LANGS = frozenset({"ar", "ja"})
# Languages that carry no spaces and so have to wrap per character.
CHAR_WRAP_LANGS = frozenset({"ja"})
# never left dangling at the start of a wrapped Japanese line (kinsoku shori)
NO_LINE_START = "、。，．・：；！？」』）】》々ー゛゜"

CREAM = (237, 235, 229)
INK = (23, 23, 23)
MUTED = (104, 104, 104)
DEVICE_BEZEL_TOP = (26, 27, 30)
DEVICE_BEZEL_BOTTOM = (6, 6, 8)
# sampled from the app's own active tab-bar label in raw/iphone/tr/08-takip.png
ACCENT = (46, 230, 255)
BRAND_DARK = (4, 22, 29)


def hn(size, index=HN_REGULAR, lang=None):
    faces = LANG_FACES.get(lang)
    if faces:
        weight = "bold" if index in (HN_BOLD, HN_COND_BOLD, HN_MEDIUM) else "regular"
        path, face_index = faces[weight]
        return ImageFont.truetype(path, size, index=face_index)
    return ImageFont.truetype(HN, size, index=index)


def font(path_or_none, size, index=HN_REGULAR, lang=None):
    """Back-compat shim: old call sites pass an Arial .ttf path; new code should
    pass index=HN_*. If given one of the old Arial paths, map it to a sane HN
    equivalent so nothing breaks. `lang` routes ar/ja to a face that actually
    has their glyphs."""
    if path_or_none in (F_BLACK, F_BOLD):
        return hn(size, HN_BOLD, lang=lang)
    if path_or_none == F_REG:
        return hn(size, HN_REGULAR, lang=lang)
    return hn(size, index, lang=lang)


def tracking_for(lang, size, default_ratio=0.012):
    """Arabic/CJK must not be tracked; see SHAPED_LANGS."""
    return 0 if lang in SHAPED_LANGS else -size * default_ratio


def fit_font(draw, text, max_w, size, index=HN_REGULAR, lang=None, min_ratio=0.62):
    """Largest font <= `size` whose single line of `text` fits `max_w`.

    The synthetic 03/06 scenes have fixed card and stat-box geometry, but the
    label inside them is a translation: "Ort. glukoz" and "Geschatztes A1C (GMI)"
    are the same slot. Without this the long ones run under the neighbouring
    number instead of wrapping. Floors at min_ratio so a runaway string is
    reported by the caller rather than shrunk to nothing."""
    f = hn(size, index, lang=lang)
    if not text or draw.textlength(text, font=f) <= max_w:
        return f
    lo = max(8, int(size * min_ratio))
    for s in range(size - 1, lo - 1, -1):
        f = hn(s, index, lang=lang)
        if draw.textlength(text, font=f) <= max_w:
            return f
    return hn(lo, index, lang=lang)


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
    if not tracking:
        # one shaped run: correct for Arabic joining/bidi, and per-char summing
        # would be wrong there anyway
        return draw.textlength(text, font=f)
    total = 0
    for ch in text:
        total += draw.textlength(ch, font=f) + tracking
    return total - tracking


def draw_text_tracked(draw, xy, text, f, fill, tracking=0):
    x, y = xy
    if not tracking:
        draw.text((x, y), text, font=f, fill=fill)
        return x + draw.textlength(text, font=f)
    for ch in text:
        draw.text((x, y), ch, font=f, fill=fill)
        x += draw.textlength(ch, font=f) + tracking
    return x


def _wrap_by_char(draw, text, f, max_w, tracking, max_lines):
    lines, cur = [], ""
    for ch in text:
        if ch == "\n":
            lines.append(cur)
            cur = ""
            continue
        if cur and text_tracked_width(draw, cur + ch, f, tracking) > max_w and ch not in NO_LINE_START:
            lines.append(cur)
            cur = ch
            if len(lines) >= max_lines:
                return lines[:max_lines]
        else:
            cur += ch
    if cur and len(lines) < max_lines:
        lines.append(cur)
    return lines[:max_lines]


def wrap_text_tracked(draw, text, f, max_w, tracking=0, max_lines=2, lang=None):
    if lang in CHAR_WRAP_LANGS:
        return _wrap_by_char(draw, text, f, max_w, tracking, max_lines)
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
def wrap_text(draw, text, f, max_w, max_lines=2, lang=None):
    return wrap_text_tracked(draw, text, f, max_w, tracking=0, max_lines=max_lines, lang=lang)


def _dropped(text, lines):
    """True when wrapping had to throw copy away (max_lines hit). Compared
    without whitespace so the joins introduced by wrapping do not count."""
    squash = lambda s: "".join(s.split())
    return len(squash("".join(lines))) < len(squash(text))


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


def row_coverage(img, y, step=8, inset=10, thr=45):
    """Fraction of a row covered by something other than the page background.

    The margin pixel is always outside the app's cards, so comparing every
    sample against it isolates card pixels. Counting them (rather than taking
    the largest difference) is what catches a wide card whose fill barely
    differs from the page: between two wrapped text lines its interior looks
    flat, but it still spans most of the row."""
    px = img.load()
    ref = px[inset, y]
    xs = range(inset, img.width - inset, step)
    hits = sum(1 for x in xs if sum(abs(px[x, y][i] - ref[i]) for i in range(3)) > thr)
    return hits / len(range(inset, img.width - inset, step))


def snap_cut(img, preferred, tabbar_top, window=220, tol=0.02, run=10):
    """Keep `preferred` when no element crosses it, else walk up to the first
    gap wide enough to cut in. Returns (cut, ok).

    The layout spec puts the canvas edge at the app tab bar's top border but
    forbids bisecting the last visible element. Card counts shift with copy
    length, so a row that is a clean gap in one language lands mid-card in
    another - snapping per capture beats hand-tuning 9 constants per panel.

    `run` consecutive clear rows are required, since the tab bar's own 1px
    separator is bare background too and matching on it alone would cut a card
    in half just above it. ok=False means the capture has no clean cut at all:
    the last card runs off the screen, which needs a scroll fix in the capture
    pass, not a different constant here."""
    if row_coverage(img, preferred) <= tol:
        return preferred, True
    clear = 0
    for y in range(min(preferred, tabbar_top), max(0, preferred - window), -1):
        if row_coverage(img, y) <= tol:
            clear += 1
            if clear >= run:
                return y + clear - 1, True
        else:
            clear = 0
    return preferred, False


def find_card_top(bottom_img, x=60, scan_from=1200, scan_to=2400, gap=30):
    """The rotation-card scroll depth isn't perfectly reproducible run to run
    (same drag can land at a different offset each time), so a fixed pixel
    crop either duplicates content already shown in the top half or leaves a
    gap. The background here is a soft gradient (drifts gradually with y), so
    comparing each row against a LOCAL row `gap` px above it - rather than one
    fixed reference - tells apart the card's real border (a sharp jump) from
    that slow drift, and from thin one-off highlight lines (which fall back to
    background within a few rows instead of staying elevated)."""
    px = bottom_img.load()
    for y in range(scan_from, scan_to):
        c, ref = px[x, y], px[x, y - gap]
        if abs(c[0] - ref[0]) + abs(c[1] - ref[1]) + abs(c[2] - ref[2]) > 15:
            c2 = px[x, y + 60]
            if abs(c2[0] - ref[0]) + abs(c2[1] - ref[1]) + abs(c2[2] - ref[2]) > 10:
                return y
    return scan_from


def stitch_bodymap(raw_dir, top_crop, card_height, crop_top=0, scan_x=60, scan_from=1200):
    """Legacy two-shot path: silhouette frame on top, rotation card scrolled
    into a second frame, joined so both stay whole."""
    top = load_cropped_shot(os.path.join(raw_dir, "02-bodymap-top.png"), crop_top, top_crop)
    bottom_full = Image.open(os.path.join(raw_dir, "02-bodymap-bottom.png")).convert("RGB")
    card_top = find_card_top(bottom_full, x=scan_x, scan_from=scan_from) - 28
    card = bottom_full.crop((0, card_top, bottom_full.size[0], card_top + card_height))
    stitched = Image.new("RGB", (top.size[0], top.size[1] + card.size[1]), (8, 14, 20))
    stitched.paste(top, (0, 0))
    stitched.paste(card, (0, top.size[1]))
    return stitched


def bodymap_shot(raw_dir, crop_top, single_crop_bottom, top_crop, card_height, **stitch_kw):
    """Prefer the one-frame capture the 2.0.0 pipeline writes (whole map fits
    on one screen now); fall back to the older two-shot stitch when only those
    files exist. Returns None when neither is present."""
    single = os.path.join(raw_dir, "02-bodymap.png")
    if os.path.exists(single):
        return load_cropped_shot(single, crop_top, single_crop_bottom)
    if all(os.path.exists(os.path.join(raw_dir, f"02-bodymap-{h}.png")) for h in ("top", "bottom")):
        return stitch_bodymap(raw_dir, top_crop, card_height, crop_top=crop_top, **stitch_kw)
    return None


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


def header_bottom(cfg):
    """y the header block would end at, without drawing anything. Lets callers
    pick a subtitle line budget that still leaves room for the chip."""
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    lang = cfg.get("lang")
    max_text_w = cfg.get("text_w", int(cfg["canvas"][0] * 0.80))
    f_head = hn(cfg["headline_size"], HN_BOLD, lang=lang)
    f_sub = hn(cfg["sub_size"], HN_REGULAR, lang=lang)
    tracking = cfg.get("headline_tracking", tracking_for(lang, cfg["headline_size"]))
    head_lines = wrap_text_tracked(probe, cfg["headline"], f_head, max_text_w,
                                   tracking=tracking, max_lines=2, lang=lang)
    sub_lines = wrap_text(probe, cfg["sub"], f_sub, max_text_w,
                          max_lines=cfg.get("sub_max_lines", 3), lang=lang)
    y = cfg["headline_top"] + len(head_lines) * int(cfg["headline_size"] * 1.08)
    y += int(cfg["headline_size"] * 0.20)
    return y + len(sub_lines) * int(cfg["sub_size"] * 1.42)


def fit_header_and_chip(cfg, chip_h, dev_y, gap, pad, max_sub_lines=3):
    """Pick a subtitle line budget and a chip y that keep the chip on the cream
    band, clear of both the subtitle and the device.

    The 2.0.0 subtitles are two sentences, so the wordiest languages overflow a
    3-line setting; and even at 2 lines the fixed `gap` can push the chip a
    handful of pixels into the bezel. Rather than dropping the chip (the layout
    spec requires it), it gets anchored to the bottom of the cream band.
    Returns (sub_max_lines, chip_y, fits)."""
    ceiling = dev_y - pad - chip_h
    for n in range(max_sub_lines, 0, -1):
        y = header_bottom(dict(cfg, sub_max_lines=n))
        if y <= ceiling:
            return n, min(y + gap, ceiling), True
    return 1, ceiling, False


def new_canvas_with_header(cfg):
    """Draws cream bg + tracked headline + subtitle. Returns (canvas, draw, y_after_text).

    cfg["lang"] (optional) selects the font family and disables manual tracking
    for shaped scripts; without it behaviour is unchanged."""
    W, H = cfg["canvas"]
    canvas = Image.new("RGB", (W, H), CREAM)
    draw = ImageDraw.Draw(canvas)

    lang = cfg.get("lang")
    margin_x = cfg["margin_x"]
    max_text_w = cfg.get("text_w", int(W * 0.80))
    f_head = hn(cfg["headline_size"], HN_BOLD, lang=lang)
    f_sub = hn(cfg["sub_size"], HN_REGULAR, lang=lang)
    tracking = cfg.get("headline_tracking", tracking_for(lang, cfg["headline_size"]))

    lines = wrap_text_tracked(draw, cfg["headline"], f_head, max_text_w,
                              tracking=tracking, max_lines=2, lang=lang)
    y = cfg["headline_top"]
    line_h = int(cfg["headline_size"] * 1.08)
    for ln in lines:
        draw_text_tracked(draw, (margin_x, y), ln, f_head, INK, tracking=tracking)
        y += line_h
    y += int(cfg["headline_size"] * 0.20)
    sub_max = cfg.get("sub_max_lines", 3)
    sub_lines = wrap_text(draw, cfg["sub"], f_sub, max_text_w, max_lines=sub_max, lang=lang)
    sub_line_h = int(cfg["sub_size"] * 1.42)
    for ln in sub_lines:
        draw.text((margin_x, y), ln, font=f_sub, fill=MUTED)
        y += sub_line_h

    for label, src, got in (("headline", cfg["headline"], lines), ("subtitle", cfg["sub"], sub_lines)):
        if _dropped(src, got):
            print(f"  WARN [{lang}] {label} truncated: {src!r}")

    return canvas, draw, y


def verify_output(path, expected_size):
    """Store rule: PNG, no alpha, exact canvas size. Returns True when OK."""
    with Image.open(path) as im:
        ok = im.size == tuple(expected_size) and im.mode == "RGB"
        if not ok:
            print(f"  FAIL {path} size={im.size} mode={im.mode} expected={tuple(expected_size)}/RGB")
    return ok
