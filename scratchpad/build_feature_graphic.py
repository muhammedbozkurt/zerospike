#!/usr/bin/env python3
"""Google Play feature graphic: 1024x500, one PNG per language.

Dark brand ground, app icon in the left block, "zerospike" wordmark plus the
localized tagline on the right, cyan accent rule between them."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image, ImageDraw, ImageFilter
from compose import (
    hn, HN_BOLD, HN_REGULAR, HN_MEDIUM, ACCENT, BRAND_DARK,
    wrap_text_tracked, tracking_for, draw_text_tracked, text_tracked_width,
    rounded_mask, verify_output, _dropped,
)
from i18n_copy import FEATURE_TAGLINE, LANGS

ICON = "/Users/muhammedbozkurt/Desktop/Others/zerospike/assets/icon.png"
OUT_DIR = "/Users/muhammedbozkurt/Desktop/Others/zerospike/zerospike-store/google-play-extras"

CANVAS = (1024, 500)
ICON_SIZE = 236
ICON_X, ICON_Y = 72, (CANVAS[1] - ICON_SIZE) // 2
TEXT_X = ICON_X + ICON_SIZE + 68
TEXT_RIGHT = CANVAS[0] - 64
WORDMARK_SIZE = 82
TAGLINE_SIZE = 34
INK = (240, 248, 250)
TAGLINE_INK = (150, 178, 188)


def brand_ground():
    """Flat brand dark plus one soft cyan glow behind the icon, so the panel
    reads as lit rather than as a flat rectangle."""
    canvas = Image.new("RGB", CANVAS, BRAND_DARK)
    glow = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    cx, cy = ICON_X + ICON_SIZE // 2, CANVAS[1] // 2
    for r, a in ((330, 26), (240, 30), (150, 34)):
        gd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ACCENT + (a,))
    glow = glow.filter(ImageFilter.GaussianBlur(90))
    out = Image.alpha_composite(canvas.convert("RGBA"), glow)
    return out.convert("RGB")


def paste_icon(canvas):
    icon = Image.open(ICON).convert("RGB").resize((ICON_SIZE, ICON_SIZE), Image.LANCZOS)
    radius = int(ICON_SIZE * 0.225)  # squircle-ish, matches the store icon mask
    shadow = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [ICON_X, ICON_Y + 14, ICON_X + ICON_SIZE, ICON_Y + ICON_SIZE + 20],
        radius=radius, fill=(0, 0, 0, 130))
    shadow = shadow.filter(ImageFilter.GaussianBlur(26))
    canvas.paste(Image.alpha_composite(canvas.convert("RGBA"), shadow).convert("RGB"), (0, 0))
    canvas.paste(icon, (ICON_X, ICON_Y), rounded_mask((ICON_SIZE, ICON_SIZE), radius))


def build(lang):
    tagline = FEATURE_TAGLINE[lang]
    canvas = brand_ground()
    paste_icon(canvas)
    draw = ImageDraw.Draw(canvas)

    max_w = TEXT_RIGHT - TEXT_X
    # the wordmark is a Latin brand name in every locale, so it never switches face
    f_mark = hn(WORDMARK_SIZE, HN_BOLD)
    f_tag = hn(TAGLINE_SIZE, HN_REGULAR, lang=lang)
    tracking = tracking_for(None, WORDMARK_SIZE, default_ratio=0.02)
    tag_tracking = tracking_for(lang, TAGLINE_SIZE)

    tag_lines = wrap_text_tracked(draw, tagline, f_tag, max_w,
                                  tracking=tag_tracking, max_lines=2, lang=lang)
    if _dropped(tagline, tag_lines):
        print(f"  WARN [{lang}] tagline truncated: {tagline!r}")

    tag_line_h = int(TAGLINE_SIZE * 1.40)
    block_h = WORDMARK_SIZE + 30 + 4 + 26 + len(tag_lines) * tag_line_h
    y = (CANVAS[1] - block_h) // 2

    draw_text_tracked(draw, (TEXT_X, y), "zerospike", f_mark, INK, tracking=tracking)
    y += WORDMARK_SIZE + 30

    rule_w = int(text_tracked_width(draw, "zerospike", f_mark, tracking) * 0.42)
    draw.rounded_rectangle([TEXT_X, y, TEXT_X + rule_w, y + 5], radius=3, fill=ACCENT)
    y += 5 + 26

    for ln in tag_lines:
        # ar centers each tagline line within the text column (icon block stays
        # put); every other language keeps the left-anchored TEXT_X, unchanged
        tx = TEXT_X
        if lang == "ar":
            tx = TEXT_X + (max_w - text_tracked_width(draw, ln, f_tag, tag_tracking)) // 2
        draw_text_tracked(draw, (tx, y), ln, f_tag, TAGLINE_INK, tracking=tag_tracking)
        y += tag_line_h

    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, f"feature-graphic-{lang}.png")
    canvas.save(out_path)
    print("wrote", out_path, canvas.size)
    return out_path


def main(argv):
    langs = argv[1:] or list(LANGS)
    if langs == ["all"]:
        langs = list(LANGS)
    written = [build(lang) for lang in langs]
    bad = [p for p in written if not verify_output(p, CANVAS)]
    print(f"\n{len(written)} file(s), canvas {CANVAS[0]}x{CANVAS[1]} RGB: "
          f"{len(written) - len(bad)} OK, {len(bad)} FAIL")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
