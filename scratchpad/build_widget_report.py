#!/usr/bin/env python3
"""One entry point for the two SYNTHETIC panels across every canvas and language.

01/02/04/05/07/08 are device captures reframed by build_iphone/build_ipad/
build_android_*; 03-widget and 06-report have no capture at all (a lock screen
and a PDF are not app screens), so they are drawn from scratch here. That split
is why they need their own driver instead of joining PANELS_2_0_0.

    python3 build_widget_report.py            # all 9 languages, all 5 canvases
    python3 build_widget_report.py tr ja ar   # a subset
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from compose import verify_output
from i18n_copy import LANGS

import build_widget            # iPhone   03
import build_widget_ipad       # iPad     03
import build_widget_android    # Android phone 03
import build_report            # iPhone   06
import build_report_ipad       # iPad     06
import build_report_android_phone  # Android phone 06
import build_widget_report_tablet  # tablet7 + tablet10, 03 + 06

BUILDERS = (
    ("iphone   03", build_widget.build_all),
    ("iphone   06", build_report.build_all),
    ("ipad     03", build_widget_ipad.build_all),
    ("ipad     06", build_report_ipad.build_all),
    ("android  03", build_widget_android.build_all),
    ("android  06", build_report_android_phone.build_all),
    ("tablets  03+06", build_widget_report_tablet.build_all),
)


def main(argv):
    langs = argv[1:] or list(LANGS)
    if langs == ["all"]:
        langs = list(LANGS)
    written = []
    for lang in langs:
        print(f"--- {lang} ---")
        for label, build in BUILDERS:
            try:
                written += build(lang)
            except Exception as exc:
                print(f"  FAIL [{lang}] {label}: {exc}")
                return 1
    bad = [p for p, size in written if not verify_output(p, size)]
    print(f"\n{len(written)} file(s) over {len(langs)} language(s): "
          f"{len(written) - len(bad)} OK, {len(bad)} FAIL")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
