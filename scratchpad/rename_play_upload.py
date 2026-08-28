#!/usr/bin/env python3
"""Normalise the Android store panels to upload-ready filenames.

The composite pipeline names its output after INTERNAL panel keys (01-ring,
02-bodymap, ...). Those keys are historical: they are not contiguous (07-spike
is not part of the Play set, so 06 jumped straight to 08) and their order has
nothing to do with the order the panels should appear in the listing. Uploading
that folder means hand-sorting 8 files per language, 27 times.

This step renames them to 01..08 in listing order. Idempotent: run it after any
composite rebuild. Renaming happens through temporary names so the two keys that
swap numbers (05-insights -> 03-insights, 03-widget -> 05-widgets) cannot
clobber each other.
"""
import os, sys

# listing order -> (pipeline key, upload name)
ORDER = [
    ("01-ring",      "01-dashboard"),
    ("04-food",      "02-quick-log"),
    ("05-insights",  "03-insights"),
    ("02-bodymap",   "04-rotation"),
    ("03-widget",    "05-widgets"),
    ("09-reminders", "06-reminders"),
    ("06-report",    "07-report"),
    ("08-takip",     "08-tracking"),
]
DIRS = ["android-phone-1080x1920", "android-tablet7-1080x1920", "android-tablet10-1600x2560"]
LANGS = ["tr", "en", "de", "es", "fr", "it", "pt", "ar", "ja"]
ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "zerospike-store")

renamed = skipped = 0
for d in DIRS:
    for lang in LANGS:
        p = os.path.join(ROOT, d, lang)
        pending = [(src, dst) for src, dst in ORDER
                   if os.path.exists(os.path.join(p, src + ".png"))]
        if not pending:
            skipped += 1
            continue
        for src, dst in pending:                      # phase 1: park under temp names
            os.rename(os.path.join(p, src + ".png"), os.path.join(p, "__tmp__" + dst + ".png"))
        for src, dst in pending:                      # phase 2: land on final names
            os.rename(os.path.join(p, "__tmp__" + dst + ".png"), os.path.join(p, dst + ".png"))
        renamed += len(pending)

print(f"renamed {renamed} file(s); {skipped} folder(s) already normalised")

bad = False
for d in DIRS:
    for lang in LANGS:
        got = sorted(f[:-4] for f in os.listdir(os.path.join(ROOT, d, lang)) if f.endswith(".png"))
        want = sorted(dst for _, dst in ORDER)
        if got != want:
            print(f"  MISMATCH {d}/{lang}: {got}")
            bad = True
print("FAIL" if bad else "OK: 3 x 9 x 8 upload-ready panels")
sys.exit(1 if bad else 0)
