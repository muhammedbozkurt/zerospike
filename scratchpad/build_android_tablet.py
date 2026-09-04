#!/usr/bin/env python3
"""Android tablet composites (tablet10 + tablet7), built from real Android
tablet captures.

2.0.0 reused the iPad raws for both canvases, because there was no Android
tablet capture pass yet. There now are two real ones - raw/android-tablet7
(1200x1920) and raw/android-tablet10 (1600x2560) - a different emulator/skin
for each form factor, not one raw set scaled two ways. So each entry in
CANVASES reads its own raw directory and carries its own crop constants,
measured directly on that raw set (row-by-row pixel inspection, cross-checked
against all 9 languages) - the two tablets differ enough in layout (05-insights
in particular reflows into a different column count) that they cannot share
one set of anchors, let alone borrow the iPad's."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image, ImageDraw
from compose import (
    new_canvas_with_header, draw_device, load_cropped_shot, font, F_BOLD,
    measure_chip, bodymap_shot, fit_header_and_chip, verify_output, align_for,
    pad_to_height, layout_chips, draw_chips, row_coverage,
)
from i18n_copy import LANGS, PANELS_2_0_0 as _ALL_PANELS, chips_for

# Lets a single panel be re-rendered on its own (env var, comma-separated
# panel keys) without touching the other 6 - needed once 09-reminders gets
# a fresh raw capture pass (permission banner hidden, list seeded fuller)
# and only it needs to be rebuilt across all 9 languages.
import os as _os
_filter = _os.environ.get("PANEL_FILTER")
PANELS_2_0_0 = tuple(p for p in _ALL_PANELS if p in _filter.split(",")) if _filter else _ALL_PANELS

RAW_ROOT = "/Users/muhammedbozkurt/Desktop/Others/zerospike/raw"
OUT_ROOT = "/Users/muhammedbozkurt/Desktop/Others/zerospike/zerospike-store"

# iPhone-baseline (1284px, see build_iphone.CHIP_DEV_GAP) minimum chip-to-
# device gap, scaled by each canvas's own width below.
IPHONE_W = 1284
CHIP_DEV_GAP_BASE = 24

CANVASES = [
    # tablet10: raw/android-tablet10, 1600x2560 native capture.
    dict(
        name="android-tablet10-1600x2560", size=(1600, 2560), dev_y=480, margin_x=70,
        headline_size=76, sub_size=33, chip_size=29, bezel=14, radius=56,
        raw_dir=os.path.join(RAW_ROOT, "android-tablet10"),
        # Measured on raw/android-tablet10/*/01-ring.png: OS status icons end
        # at y=39, the app header's own buttons start at y=88 in every
        # language - 60 sits comfortably in that gap.
        status_crop=60,
        # App's own bottom tab bar background starts at y=2400 in every
        # language (fixed chrome).
        tabbar_top=2400,
        # 07-spike composer bottom edge (2476) + margin. Both pinned, stable
        # across all 9 languages.
        spike_composer_bottom=2500,
        # 08-takip crop_top = this minus CONTENT_H, so it has to clear the
        # back-chevron/language-pill row (content y=95-146 in every language,
        # LTR and mirrored RTL both) as a whole - landing crop_top inside that
        # range cuts the pill/chevron in half instead of just its top sliver
        # (verified broken on a first pass: half a "DE"/"AR" glyph left
        # floating). 2490 clears it (crop_top=150, the progress bar at
        # y=164 and the skip-link at y<=2436 both stay fully framed) with
        # comfortable margin below the gesture-nav pill at y=2524.
        takip_footer_bottom=2490,
        # 05-insights: last card's end ranges 2086-2208 across languages.
        # The default row_coverage threshold (45) already tells every card
        # apart from the page background on this raw set, so the plain
        # snap_cut walk is used as-is.
        insights_snap_window=400,
        insights_snap_thr=45,
    ),
    # tablet7: raw/android-tablet7, 1200x1920 native capture.
    dict(
        name="android-tablet7-1080x1920", size=(1080, 1920), dev_y=360, margin_x=48,
        headline_size=58, sub_size=25, chip_size=22, bezel=11, radius=42,
        raw_dir=os.path.join(RAW_ROOT, "android-tablet7"),
        # Measured on raw/android-tablet7/*/01-ring.png: OS status icons end
        # at y=39, the app header's own buttons start at y=88 in every
        # language - 60 sits comfortably in that gap.
        status_crop=60,
        # App's own bottom tab bar background starts at y=1760 in every
        # language (fixed chrome).
        tabbar_top=1760,
        # 07-spike composer bottom edge (1836) + margin. Pinned, stable
        # across all 9 languages.
        spike_composer_bottom=1860,
        # 08-takip: see the tablet10 entry's comment - same fix, same content
        # geometry, this raw set's own numbers (pill/chevron content y=95-146,
        # progress bar at y=164, skip-link ends by y=1796, gesture-nav pill at
        # y=1884). 1850 -> crop_top=150.
        takip_footer_bottom=1850,
        # 05-insights on this narrower canvas reflows into two independent
        # card columns whose last visible cards essentially never end at the
        # same row (see two_col_insights_shot): the single full-width
        # snap_cut_thr walk only finds the rare row where BOTH columns
        # happen to have a gap at once, which in every language was the very
        # first inter-card gap (~1047-1087) - a screen and a half above the
        # raw capture's real bottom, rendering as a page of flat dark fill
        # under "This week vs. last week". insights_two_col routes this
        # panel through the per-column snap instead (below).
        insights_two_col=True,
    ),
]

# The note size that goes on the OUTPUT canvas differs per spec above, but the
# rendering rules for a given raw set (which panels crop directly at
# tabbar_top, which snap, which are EXCEPTION) are identical for both -
# they're properties of the app UI, not of the output canvas.
SNAP_PANELS = {"05-insights"}
PAD_PANELS = {"05-insights"}
EXCEPTION_PANELS = {"07-spike", "08-takip"}
# Clearance so the drawn punch-hole camera doesn't sit on the header; real bg
# color, no invented clock/battery glyphs - see build_android_phone.STATUS_BAND.
STATUS_BAND = 40


def with_status_band(shot, band_h=STATUS_BAND):
    """Prepend a band of the shot's own top-row pixels, column by column so any
    horizontal gradient carries through."""
    out = Image.new("RGB", (shot.width, shot.height + band_h))
    out.paste(shot.crop((0, 0, shot.width, 1)).resize((shot.width, band_h)), (0, 0))
    out.paste(shot, (0, band_h))
    return out


def snap_cut_thr(img, preferred, tabbar_top, window, thr, tol=0.02, run=10):
    """Same walk as compose.snap_cut, but with a configurable row_coverage
    threshold - some raw sets need a lower one (see insights_snap_thr)."""
    if row_coverage(img, preferred, thr=thr) <= tol:
        return preferred, True
    clear = 0
    for y in range(min(preferred, tabbar_top), max(0, preferred - window), -1):
        if row_coverage(img, y, thr=thr) <= tol:
            clear += 1
            if clear >= run:
                return y + clear - 1, True
        else:
            clear = 0
    return preferred, False


def crop_bottom_for(spec, key):
    tabbar_top = spec["tabbar_top"]
    if key == "07-spike":
        return spec["spike_composer_bottom"]
    if key == "08-takip":
        return spec["takip_footer_bottom"]
    # 01-ring/02-bodymap/04-food/09-reminders all read as clean background
    # (or, for 01-ring, a fully-framed hint line) at tabbar_top in every
    # language; 05-insights uses it only as the snap-search's preferred row.
    return tabbar_top


def two_col_bounds(w, inset=20, margin_frac=0.08):
    """x-ranges for 05-insights' two card columns on the tablet7 raw set. The
    two columns sit either side of a gutter centred on the image; margin_frac
    keeps the sampled band clear of both the gutter and each column's own
    rounded card edge (measured on raw/android-tablet7/*/05-insights.png: the
    real gutter runs roughly w*0.46-w*0.53 across all 9 languages, comfortably
    inside this margin on either side)."""
    mid = w // 2
    m = int(w * margin_frac)
    return inset, mid - m, mid + m, w - inset


def col_coverage_adaptive(img, y, x0, x1, step=4, thr=18):
    """Row 'coverage' for one 05-insights card column.

    compose.row_coverage compares every sample to a single margin pixel,
    which is fine for a full-width row but not a lone column: the page
    background on this raw set carries a soft ~20-RGB-sum gradient across a
    column's own width (measured on the tr/es captures), enough on its own
    to read as "card present" against a reference pixel taken from the
    opposite side of the screen. Comparing each sample to the row's own
    darkest pixel sidesteps that - this is a dark-mode UI, so a card fill is
    never darker than the page behind it; in a real gap the darkest sample
    is the page itself and every other sample matches it, while inside a
    card there is no true page-background pixel left to pull the ratio
    down."""
    px = img.load()
    xs = range(x0, x1, step)
    vals = [px[x, y] for x in xs]
    base = min(vals, key=lambda c: sum(c))
    hits = sum(1 for c in vals if sum(abs(c[i] - base[i]) for i in range(3)) > thr)
    return hits / len(vals)


def snap_col(img, x0, x1, preferred, window, thr=18, tol=0.05, run=10):
    """Same walk as compose.snap_cut, scoped to one card column via
    col_coverage_adaptive instead of the full-width row_coverage."""
    if col_coverage_adaptive(img, preferred, x0, x1, thr=thr) <= tol:
        return preferred, True
    clear = 0
    for y in range(preferred, max(0, preferred - window), -1):
        if col_coverage_adaptive(img, y, x0, x1, thr=thr) <= tol:
            clear += 1
            if clear >= run:
                return y + clear - 1, True
        else:
            clear = 0
    return preferred, False


def patch_short_column(img, x0, x1, from_y, to_y):
    """Extend the shorter of 05-insights' two columns down to the taller
    one's cut with its own trailing background row (the same repeat-last-row
    technique compose.pad_to_height uses), so the shorter column shows blank
    page background under its last complete card instead of whatever -
    possibly bisected - content the raw capture happens to have there."""
    if to_y <= from_y + 1:
        return
    band = img.crop((x0, from_y - 1, x1, from_y)).resize((x1 - x0, to_y - from_y))
    img.paste(band, (x0, from_y))


def two_col_insights_shot(path, status_crop, tabbar_top, label=""):
    """05-insights reflows into two independent card columns on the tablet7
    canvas; their last visible cards essentially never end at the same row,
    so the plain full-width snap_cut_thr only finds the rare row where BOTH
    columns happen to have a gap at once - in every language that was the
    very first inter-card gap, a screen and a half above the raw capture's
    real bottom (see the S7 store-panel ticket: the composite showed a page
    of flat dark fill under "This week vs. last week"). Snapping each column
    on its own, then background-filling the shorter one down to the taller
    one's cut, uses the real content the capture already has without ever
    bisecting a card in either column.

    S3 fix: the walk used to start at the raw capture's own bottom edge
    (h - 20) with no upper bound, well past tabbar_top - the app's fixed
    chrome starts there, but a card that renders behind it (only in the raw
    pixel buffer, never actually visible on screen) reads as flat "page
    background" too, so in en/de/fr/it/pt/ar/ja the walk locked onto a gap
    below tabbar_top and produced a shot taller than every other panel's
    content_h, throwing off dev_rect height on the composite (tr/es have
    short enough copy that their last real card already ends above
    tabbar_top, so they were never affected). Capping the anchor at
    tabbar_top - 1 keeps every candidate inside content_h; window=400 is far
    enough to still reach each column's real last-card gap (measured
    119-253px back) but short of the false early gap from the bug above
    (measured ~700px back), so a column with no clean gap in range now falls
    back to the tabbar_top boundary itself instead of overshooting past it.

    de/fr/it/pt/ja's right column has that same real gap right below
    tabbar_top too (measured at the same rows tr/es/en/ar land on), but only
    an 8-9-row clean run - snap_col's default run=10 missed it by a hair and
    fell back to the boundary, bisecting the next card's row of numbers.
    run=8 catches it (still well clear of a single stray row, per snap_col's
    own reasoning for requiring a run at all)."""
    with Image.open(path) as im0:
        full = im0.convert("RGB")
    w, h = full.size
    lx0, lx1, rx0, rx1 = two_col_bounds(w)
    anchor = min(h - 20, tabbar_top - 1)
    window = 400
    lc, lok = snap_col(full, lx0, lx1, anchor, window, run=8)
    rc, rok = snap_col(full, rx0, rx1, anchor, window, run=8)
    if not lok or not rok:
        print(f"  WARN {label}: two-col snap found no clean gap in a column "
              f"(left ok={lok}, right ok={rok}); that side may show a "
              f"bisected card.")
    cut = max(lc, rc)
    mid = w // 2
    if lc < cut:
        patch_short_column(full, 0, mid, lc, cut)
    elif rc < cut:
        patch_short_column(full, mid, w, rc, cut)
    print(f"  two-col cut {label}: left={lc}({lok}) right={rc}({rok}) -> {cut}")
    return full.crop((0, status_crop, w, cut))


def cut_for(spec, path, key):
    preferred = crop_bottom_for(spec, key)
    if key not in SNAP_PANELS:
        return preferred
    with Image.open(path) as im:
        cut, ok = snap_cut_thr(im.convert("RGB"), preferred, spec["tabbar_top"],
                                spec["insights_snap_window"], spec["insights_snap_thr"])
    if not ok:
        print(f"  WARN {spec['name']}/{key}: no clean cut in this capture; kept {cut}. "
              f"The last card is bisected - re-capture with a different scroll.")
    elif cut != preferred:
        print(f"  cut {spec['name']}/{key}: {preferred} -> {cut} (snapped clear of a card)")
    return cut


def load_shot(spec, raw_dir, key):
    content_h = spec["tabbar_top"] - spec["status_crop"]
    if key == "02-bodymap":
        single = os.path.join(raw_dir, "02-bodymap.png")
        if not os.path.exists(single):
            return None
        cb = cut_for(spec, single, key)
        shot = bodymap_shot(raw_dir, spec["status_crop"], cb, 0, 0)
    else:
        path = os.path.join(raw_dir, f"{key}.png")
        if not os.path.exists(path):
            return None
        if key == "05-insights" and spec.get("insights_two_col"):
            shot = two_col_insights_shot(path, spec["status_crop"], spec["tabbar_top"],
                                          label=f"{spec['name']}/{key}")
        else:
            bottom = cut_for(spec, path, key)
            if key in EXCEPTION_PANELS:
                top = max(0, bottom - content_h)
            else:
                top = spec["status_crop"]
            shot = load_cropped_shot(path, top, bottom)
    if shot is None:
        return None
    shot = with_status_band(shot)
    if key in PAD_PANELS:
        shot = pad_to_height(shot, content_h + STATUS_BAND)
    return shot


def build_for_canvas(lang, spec, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    W, H = spec["size"]
    margin_x, dev_y, bezel, radius = spec["margin_x"], spec["dev_y"], spec["bezel"], spec["radius"]
    BASE = dict(canvas=spec["size"], margin_x=margin_x, headline_top=margin_x,
                headline_size=spec["headline_size"], sub_size=spec["sub_size"],
                chip_size=spec["chip_size"], text_w=int(W * 0.80))
    dev_w_std = W - 2 * margin_x
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    raw_dir_lang = os.path.join(spec["raw_dir"], lang)
    written = []

    def add_punch_hole(canvas, dev_x, dw):
        d = ImageDraw.Draw(canvas)
        cx = dev_x + dw // 2
        cy = dev_y + bezel + int(bezel * 1.6)
        r = max(6, int(bezel * 0.6))
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(3, 3, 4))

    for key in PANELS_2_0_0:
        shot = load_shot(spec, raw_dir_lang, key)
        if shot is None:
            print(f"SKIP {lang}/{spec['name']}/{key}: raw capture missing")
            continue
        headline, sub, chips = chips_for(lang, key, platform="android")
        cfg = dict(BASE, headline=headline, sub=sub, lang=lang, align=align_for(lang))
        f_chip = font(F_BOLD, cfg["chip_size"], lang=lang)
        chip_stack_gap = int(margin_x * 0.35)
        available_w = W - 2 * margin_x
        orientation, block_w, block_h, boxes = layout_chips(probe, chips, f_chip, available_w, gap_y=chip_stack_gap)
        gap = int(margin_x * 0.4)
        chip_dev_gap = round(CHIP_DEV_GAP_BASE * W / IPHONE_W)
        cfg["sub_max_lines"], cy0, fits = fit_header_and_chip(
            cfg, block_h, dev_y, gap, chip_dev_gap)
        if not fits:
            print(f"  WARN [{lang}] chip overlaps the header band")

        dw = dev_w_std
        dev_x = (W - dw) // 2

        canvas, draw, y_after = new_canvas_with_header(cfg)
        dev_box = draw_device(canvas, shot, dev_x, dev_y, dw, bezel, radius)
        add_punch_hole(canvas, dev_x, dw)
        draw_chips(canvas, draw, chips, cfg, f_chip, cy0, orientation, boxes, gap_y=chip_stack_gap)

        out_path = os.path.join(out_dir, f"{key}.png")
        canvas.save(out_path)
        print("wrote", out_path, canvas.size, "dev_box", dev_box, "content", shot.size)
        written.append((out_path, spec["size"]))
    return written


def build_all(lang):
    written = []
    for spec in CANVASES:
        raw_dir_lang = os.path.join(spec["raw_dir"], lang)
        if not os.path.isdir(raw_dir_lang):
            print(f"SKIP {lang}/{spec['name']}: no raw dir {raw_dir_lang}")
            continue
        written += build_for_canvas(lang, spec, os.path.join(OUT_ROOT, spec["name"], lang))
    return written


def main(argv):
    langs = argv[1:] or list(LANGS)
    if langs == ["all"]:
        langs = list(LANGS)
    written = []
    for lang in langs:
        print(f"--- {lang} ---")
        written += build_all(lang)
    bad = [p for p, size in written if not verify_output(p, size)]
    print(f"\n{len(written)} file(s): {len(written) - len(bad)} OK, {len(bad)} FAIL")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
