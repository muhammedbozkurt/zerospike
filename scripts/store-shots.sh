#!/usr/bin/env bash
#
# store-shots.sh — raw store-screenshot capture pipeline (HUMAN-run).
#
# Prereqs (this script CANNOT provision them; run on a Mac with the tooling):
#   - Xcode + simulators: "iPhone 16 Pro Max" (6.9") and "iPad Pro 13-inch (M4)".
#   - A screenshot-mode dev build INSTALLED on each simulator, built with
#       EXPO_PUBLIC_SCREENSHOT_MODE=1  (double lock: __DEV__ is already dev).
#     e.g.  EXPO_PUBLIC_SCREENSHOT_MODE=1 npx expo run:ios --device "iPhone 16 Pro Max"
#   - Android: an emulator booted, with the same screenshot-mode build installed.
#
# What it does: for each language, deep-links the app (scLang switches the in-app
# language; the route + screenshot params drive navigation — all gated by
# isScreenshotMode()), waits, and captures raw PNGs into raw/<device>/<lang>/.
# The raw shots feed the hypershots composite step (Faz 3); they need not be at
# store size, only crisp.
#
# Usage:  scripts/store-shots.sh ios      # iPhone + iPad
#         scripts/store-shots.sh android
set -euo pipefail

SCHEME="zerospike"
LANGS=(tr en de es fr it pt ar ja)
OUT="raw"

# route key -> deep-link path+query (scLang is appended per language).
# 01-ring dashboard, 02-bodymap heat map zoomed, 03-widget composited separately
# (lock screen + widget mock; not a device shot), 04-food, 05-insights custom
# range, 06-report rendered from the print HTML (see note below).
declare -a SHOTS=(
  "01-ring|/(tabs)"
  "02-bodymap|/(tabs)/injection?segment=map&zoom=abdomen_left_upper"
  "04-food|/(tabs)/food"
  "05-insights|/insights?custom=1"
  "07-spike|/spike"
  "08-takip|/onboarding?scOnboarding=none"
)
# 03-widget: NOT a device capture (lock-screen + widget composite). If a Live
# Activity screenshot is desired, capture it manually on the lock screen.
# 06-report: open the Data settings and export a PDF, then screenshot the print
# preview / the rendered HTML (the report is print HTML, not an in-app screen).

open_url() { # $1 = full url
  if [[ "$PLATFORM" == "ios" ]]; then
    xcrun simctl openurl booted "$1"
  else
    adb shell am start -a android.intent.action.VIEW -d "$1" >/dev/null
  fi
}

shoot() { # $1 = device dir, $2 = lang, $3 = shot key
  local dir="$OUT/$1/$2"
  mkdir -p "$dir"
  if [[ "$PLATFORM" == "ios" ]]; then
    xcrun simctl io booted screenshot "$dir/$3.png"
  else
    adb exec-out screencap -p > "$dir/$3.png"
  fi
  echo "  captured $dir/$3.png"
}

status_bar_ios() {
  xcrun simctl status_bar booted override \
    --time "9:41" --batteryLevel 100 --batteryState charged \
    --cellularBars 4 --wifiBars 3 --dataNetwork wifi
}

status_bar_android() {
  adb shell settings put global sysui_demo_allowed 1
  adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941 >/dev/null
  adb shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false >/dev/null
  adb shell am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4 >/dev/null
}

capture_for_device() { # $1 = device output dir label
  local devdir="$1"
  echo "== device: $devdir =="
  [[ "$PLATFORM" == "ios" ]] && status_bar_ios || status_bar_android
  for lang in "${LANGS[@]}"; do
    echo " lang: $lang"
    for shot in "${SHOTS[@]}"; do
      local key="${shot%%|*}"
      local path="${shot#*|}"
      local sep="?"; [[ "$path" == *"?"* ]] && sep="&"
      open_url "${SCHEME}://${path}${sep}scLang=${lang}"
      sleep 3.5
      shoot "$devdir" "$lang" "$key"
    done
  done
}

PLATFORM="${1:-ios}"
case "$PLATFORM" in
  ios)
    # iPhone pass first (the iPhone 16 Pro Max must be the BOOTED sim now).
    echo "Ensure the iPhone 16 Pro Max simulator is booted and the screenshot build is installed."
    capture_for_device "iphone"
    # Do NOT capture the iPad from the iPhone sim. Pause until the human has
    # shut down the iPhone and booted the iPad, so no iPhone frame is written
    # into the ipad/ folder.
    read -r -p $'\niPhone pass done. Now boot ONLY the iPad Pro 13" simulator (shut down the iPhone), then press Enter to continue... '
    IPAD_UDID="$(xcrun simctl list devices booted | grep -i "iPad" | head -1 | sed -E 's/.*\(([0-9A-Fa-f-]+)\).*/\1/')"
    if [[ -z "$IPAD_UDID" ]]; then
      echo "No booted iPad simulator found — aborting the iPad pass so no wrong-device frames are written." >&2
      exit 1
    fi
    capture_for_device "ipad"
    ;;
  android)
    capture_for_device "android-phone"
    ;;
  *)
    echo "usage: $0 [ios|android]" >&2; exit 1;;
esac

echo "Done. Raw shots in ./$OUT/ — feed them to the hypershots composite (Faz 3)."
