#!/usr/bin/env python3
"""Independent, pixel-scan proof for the fixed device-frame work.

Does not import any of the build_*.py modules or trust their own printed
"dev_box" line - it re-derives the device bezel's bounding box straight from
the rendered PNG pixels (band-min method: for each row, the [min_x, max_x]
band of "not page background" pixels; the device's straight left/right edges
are the widest, most common band across the rows that belong to it, and its
top/bottom are the first/last row with any such band at all). It also
re-derives, from the same pixels, the gap between the chip block's bottom
edge and the device frame's top edge (dev_y), and checks it against each
canvas's required minimum.

Usage: python3 verify_composites.py [canvas ...]  (default: all 5)
Exit code 1 if any canvas has a dev-rect deviation, a missing file, or a
chip/device-gap violation.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
from PIL import Image
from i18n_copy import LANGS, PANELS_2_0_0

STORE = "/Users/muhammedbozkurt/Desktop/Others/zerospike/zerospike-store"
CREAM = np.array([237, 235, 229])
BG_THR = 300         # sum-of-abs-diff above this = "not page background" (solid bezel only).
# True bezel-vs-cream diff is ~618-681 (DEVICE_BEZEL_TOP/BOTTOM in compose.py
# vs CREAM); the device's soft drop shadow blends the same dark color at
# partial alpha, which can still exceed a low threshold for a wide blurred
# radius around the device and inflate the measured box. 300 sits well above
# what the shadow's blend produces and well below the solid bezel's own
# diff - verified against raw pixel samples (iphone tr/01-ring.png, y=1500:
# thresholds 300 and 450 both land exactly on dev_x=64/dev_x2=1219, the
# known-correct edges; 60 picks up shadow bleed out to x=10/x=1275).
CORE_FRACTION = 0.85  # rows counted as "core" device rows need >= this fraction of the max band width
NEAR_WHITE = 248      # per-channel floor for "this pixel is a chip fill pixel"

# canvas -> (folder name, required minimum chip-bottom-to-dev_y gap in px)
# Gaps are build_iphone.CHIP_DEV_GAP (24) scaled by each canvas's own width
# relative to the iPhone canvas (1284px) - see each build_*.py's own
# CHIP_DEV_GAP constant, reproduced here so this script never has to import
# (and therefore never silently trusts) the build code.
CANVASES = {
    "iphone-1284x2778": 24,
    "ipad-2064x2752": round(24 * 2064 / 1284),
    "android-phone-1080x1920": round(24 * 1080 / 1284),
    "android-tablet10-1600x2560": round(24 * 1600 / 1284),
    "android-tablet7-1080x1920": round(24 * 1080 / 1284),
}


def band_mask(arr):
    """Boolean HxW mask of pixels that differ from the cream page background
    by more than BG_THR (sum of abs channel diffs)."""
    diff = np.abs(arr.astype(np.int16) - CREAM.astype(np.int16)).sum(axis=2)
    return diff > BG_THR


def measure_dev_rect(arr):
    """Band-min: per row, the [min_x, max_x] extent of "not background"
    pixels. At BG_THR=300 both the bezel and dark ink headline/subtitle text
    pass that test (both are near-black), so a wide-band row alone doesn't
    prove it's the device - a headline line can get close to the bezel's own
    width. What uniquely identifies the device is that its wide-band rows
    run CONTIGUOUSLY for ~2000+ px, while any text block is at most a few
    lines (a few hundred px) tall before a gap. So: find every contiguous
    run of wide-band rows and keep the longest one - the bezel wins by a wide
    margin over any headline/subtitle/chip block."""
    mask = band_mask(arr)
    rows_any = np.where(mask.any(axis=1))[0]
    if len(rows_any) == 0:
        return None
    widths = np.zeros(arr.shape[0], dtype=np.int32)
    min_xs = np.full(arr.shape[0], -1, dtype=np.int32)
    max_xs = np.full(arr.shape[0], -1, dtype=np.int32)
    for y in rows_any:
        xs = np.where(mask[y])[0]
        min_xs[y], max_xs[y] = xs[0], xs[-1]
        widths[y] = xs[-1] - xs[0]
    max_w = widths.max()
    wide = widths >= max_w * CORE_FRACTION
    # contiguous runs of `wide`, tolerating tiny 1-2px gaps (antialiasing)
    runs, start, gap = [], None, 0
    for y in range(len(wide)):
        if wide[y]:
            if start is None:
                start = y
            gap = 0
        elif start is not None:
            gap += 1
            if gap > 2:
                runs.append((start, y - gap))
                start = None
                gap = 0
    if start is not None:
        runs.append((start, len(wide) - 1 - gap))
    dev_y, dev_bottom = max(runs, key=lambda r: r[1] - r[0])
    dev_h = dev_bottom - dev_y + 1
    core = np.arange(dev_y, dev_bottom + 1)
    core = core[widths[core] >= max_w * CORE_FRACTION]
    # mode of min_x/max_x among core rows = the straight bezel edges (rounded
    # corners narrow the band, so they're a minority and lose the mode)
    vals, counts = np.unique(min_xs[core], return_counts=True)
    dev_x = int(vals[np.argmax(counts)])
    vals, counts = np.unique(max_xs[core], return_counts=True)
    dev_x2 = int(vals[np.argmax(counts)])
    dev_w = dev_x2 - dev_x + 1
    return (dev_x, dev_y, dev_w, dev_h)


def measure_chip_gap(arr, dev_y):
    """Bottom-most row (strictly above dev_y) containing a near-white
    (chip fill) pixel; returns dev_y - that row, or None if no chip found."""
    region = arr[:dev_y]
    near_white = (region >= NEAR_WHITE).all(axis=2)
    rows = np.where(near_white.any(axis=1))[0]
    if len(rows) == 0:
        return None
    chip_bottom = int(rows.max())
    return dev_y - chip_bottom  # rows chip_bottom+1 .. dev_y-1 are the empty gap; dev_y - chip_bottom counts it inclusively of the dev_y boundary, matching fit_header_and_chip's own `pad` (ceiling = dev_y - pad - chip_h)


def rects_close(a, b, tol=1):
    return all(abs(x - y) <= tol for x, y in zip(a, b))


def verify_canvas(folder, min_gap):
    base = os.path.join(STORE, folder)
    rects = {}
    gap_violations = []
    missing = []
    n = 0
    for lang in LANGS:
        for key in PANELS_2_0_0:
            path = os.path.join(base, lang, f"{key}.png")
            if not os.path.exists(path):
                missing.append(f"{lang}/{key}")
                continue
            arr = np.array(Image.open(path).convert("RGB"))
            rect = measure_dev_rect(arr)
            n += 1
            if rect is None:
                gap_violations.append((f"{lang}/{key}", "no device rect found"))
                continue
            rects[f"{lang}/{key}"] = rect
            gap = measure_chip_gap(arr, rect[1])
            if gap is None:
                continue  # no chip pixels above dev_y is fine (shouldn't happen, every panel has >=1 chip)
            if gap < min_gap:
                gap_violations.append((f"{lang}/{key}", f"chip-to-device gap {gap}px < required {min_gap}px"))

    if not rects:
        print(f"{folder}: NO FILES FOUND")
        return False

    ref_key = next(iter(rects))
    ref_rect = rects[ref_key]
    deviations = [(k, r) for k, r in rects.items() if not rects_close(r, ref_rect)]

    ok = not deviations and not missing and not gap_violations
    status = "sapma yok" if not deviations else f"{len(deviations)} SAPMA"
    print(f"{folder}: dev_rect={ref_rect}, {n} dosya, {status}, "
          f"chip-gap>=?{min_gap}px: {'OK' if not gap_violations else str(len(gap_violations))+' IHLAL'}")
    if missing:
        print(f"  MISSING ({len(missing)}): {missing}")
    if deviations:
        for k, r in deviations:
            print(f"  DEV_RECT SAPMA {k}: {r} (ref {ref_rect})")
    if gap_violations:
        for k, msg in gap_violations:
            print(f"  GAP IHLAL {k}: {msg}")
    return ok


def main(argv):
    targets = argv[1:] or list(CANVASES)
    all_ok = True
    for folder in targets:
        if folder not in CANVASES:
            print(f"unknown canvas {folder}, expected one of {list(CANVASES)}")
            all_ok = False
            continue
        ok = verify_canvas(folder, CANVASES[folder])
        all_ok = all_ok and ok
    print()
    print("RESULT:", "ALL OK" if all_ok else "FAILURES ABOVE - DUR")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
