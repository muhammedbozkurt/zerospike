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
#         scripts/store-shots.sh iphone   # (or ipad) single device, non-interactive
#         scripts/store-shots.sh android
#         SHOTS_ONLY=02-bodymap,05-insights scripts/store-shots.sh android   # panel filter (optional)
set -euo pipefail

SCHEME="zerospike"
BUNDLE_ID="com.greeneyeapp.zerospike"
LANGS=(tr en de es fr it pt ar ja)
OUT="raw"
# Seconds to wait after a cold launch before the app is considered settled. A
# debug build pulls its whole bundle from Metro, so this is much longer than the
# warm deep-link settle below.
COLD_SETTLE="${SHOTS_COLD_SETTLE:-50}"

# route key -> deep-link path+query (scLang is appended per language).
# 01-ring dashboard, 02-bodymap heat map zoomed, 03-widget a mock scene
# (app/sc-widgets.tsx: lock screen + Dynamic Island + home widgets on iOS,
# real react-native-android-widget previews on Android - see note below),
# 04-food, 05-insights custom range, 06-report rendered from the print HTML
# (see note below).
declare -a SHOTS=(
  "01-ring|/(tabs)"
  # NO zoom= on purpose: the store frame is the full-body heat map, the same
  # framing that shipped. (initialZoom is optional; without it the map stays on
  # FULL_VIEW.) A zoom= region crops to one body part, which reads as a detail
  # shot rather than as the feature. Adding one back needs a real InjectionSite
  # from InjectionBodyMap's GEOMETRY map (abdomen_left/right, thigh_left/right,
  # arm_left/right, buttock_left/right); anything else silently no-ops.
  "02-bodymap|/(tabs)/injection?segment=map"
  "03-widget|/sc-widgets"
  "04-food|/(tabs)/food"
  "05-insights|/insights?custom=1"
  "07-spike|/spike"
  "08-takip|/onboarding?scOnboarding=none"
  "09-reminders|/settings/reminders"
)
# 03-widget: IS a device capture. iOS draws a hand-built replica of the
# WidgetKit targets (no extension surface to point a deep link at); Android
# renders the actual widget trees through react-native-android-widget's
# WidgetPreview, which only produces a real bitmap on Android itself - so the
# android PLATFORM pass is the only capture that shows real widget pixels for
# this panel; run it on a real/emulated Android device, not composited from
# the iOS shots the way the other panels' Android art is.
# 06-report: open the Data settings and export a PDF, then screenshot the print
# preview / the rendered HTML (the report is print HTML, not an in-app screen).

open_url() { # $1 = full url
  if [[ "$PLATFORM" == "ios" ]]; then
    xcrun simctl openurl booted "$1"
  else
    # adb joins argv into one string and hands it to the DEVICE shell, so the
    # url must survive a second round of shell parsing: "(tabs)" is a subshell
    # ("syntax error: unexpected '('") and "&" backgrounds the command, losing
    # every query param after it. Single-quoting is what stops that; the urls
    # built here never contain a single quote.
    adb reverse tcp:8081 tcp:8081 >/dev/null 2>&1 || true
    adb shell am start -a android.intent.action.VIEW -d "'$1'" >/dev/null
  fi
}

shoot() { # $1 = device dir, $2 = lang, $3 = shot key
  local dir="$OUT/$1/$2"
  mkdir -p "$dir"
  # Capture to a temp file, then mv: macOS refuses to let simctl overwrite an
  # existing PNG that carries a com.apple.provenance xattr ("Operation not
  # permitted"), while a rename over it works.
  local tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/shot.XXXXXX")"
  if [[ "$PLATFORM" == "ios" ]]; then
    xcrun simctl io booted screenshot --type=png "$tmp"
  else
    # App activity brings the tablet satellite glyph back; re-assert demo mode right before the capture.
    status_bar_android >/dev/null 2>&1
    sleep 1
    adb exec-out screencap -p > "$tmp"
  fi
  chmod 644 "$tmp"
  mv -f "$tmp" "$dir/$3.png"
  echo "  captured $dir/$3.png"
}

# Deep links stack: each openurl pushes onto whatever is already presented, so
# without this the backdrop behind a sheet (07-spike is presentation:"modal";
# 08/09 sit on top of whatever the previous shot left) is whatever the PREVIOUS
# shot happened to be, and it differs per language and per device. Returning to
# the dashboard first makes every sheet's backdrop the same dashboard, and also
# forces a fresh mount so screenshot params (02-bodymap's segment/zoom) are
# re-read instead of being ignored by an already-mounted screen.
DASHBOARD_PATH="/(tabs)"
reset_to_dashboard() { # $1 = lang
  open_url "${SCHEME}://${DASHBOARD_PATH}?scLang=${1}"
  sleep 1.5
}

# Mirrors isRTLLang() in lib/i18n/index.ts: Arabic is the only RTL locale.
is_rtl_lang() { [[ "$1" == "ar" ]]; }

app_terminate() {
  if [[ "$PLATFORM" == "ios" ]]; then
    xcrun simctl terminate booted "$BUNDLE_ID" >/dev/null 2>&1 || true
  else
    adb shell am force-stop "$BUNDLE_ID" >/dev/null 2>&1 || true
  fi
}

# Writing direction is fixed for the LIFETIME OF THE PROCESS, so it cannot be
# switched by a deep link mid-pass. app/_layout.tsx runs its RTL sync once per
# launch (rtlSyncDone) and, in screenshot mode, only writes I18nManager's
# force/allowRTL flags without reloading; setLanguage() in lib/i18n/index.ts
# never touches I18nManager at all. RN reads those flags natively at process
# start. So a pass that never relaunches renders every language in whatever
# direction the app happened to launch in: that is how a whole iPhone set came
# out mirrored for the eight LTR languages while the iPad set rendered Arabic
# left-to-right.
#
# Two cold launches converge it on both platforms: the first records the flag
# for $1, the second starts a process that reads it back.
establish_direction() { # $1 = lang
  echo " establishing writing direction from '$1' (2 cold launches)"
  local i
  for i in 1 2; do
    app_terminate
    sleep "${SHOTS_DIR_SETTLE:-5}"
    if [[ "$PLATFORM" == "android" ]]; then
      open_url "${SCHEME}://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
      sleep "$COLD_SETTLE"
      open_url "${SCHEME}://${DASHBOARD_PATH}?scLang=${1}"
      sleep 6
    else
      open_url "${SCHEME}://${DASHBOARD_PATH}?scLang=${1}"
      sleep "$COLD_SETTLE"
    fi
  done
}

# SHOTS_ONLY (comma-separated shot keys, e.g. 02-bodymap,05-insights) narrows the
# panel loop only; per-language setup (direction launches, status bar) is untouched.
# Unset or empty keeps every panel. Unknown keys abort before any device command.
select_shots() {
  SELECTED=()
  if [[ -z "${SHOTS_ONLY:-}" ]]; then
    SELECTED=("${SHOTS[@]}")
    return 0
  fi
  local want wanted shot found
  IFS=',' read -r -a wanted <<< "$SHOTS_ONLY"
  for want in "${wanted[@]}"; do
    want="${want// /}"
    [[ -n "$want" ]] || continue
    found=0
    for shot in "${SHOTS[@]}"; do
      if [[ "${shot%%|*}" == "$want" ]]; then SELECTED+=("$shot"); found=1; break; fi
    done
    if ((!found)); then
      echo "SHOTS_ONLY: unknown panel '$want'. Valid: $(printf '%s ' "${SHOTS[@]%%|*}")" >&2
      return 1
    fi
  done
  if ((${#SELECTED[@]} == 0)); then
    echo "SHOTS_ONLY is set but names no panel." >&2
    return 1
  fi
}

capture_lang() { # $1 = device output dir label, $2 = lang
  local devdir="$1" lang="$2"
  echo " lang: $lang"
  local shot key path sep
  for shot in "${SELECTED[@]}"; do
    key="${shot%%|*}"
    path="${shot#*|}"
    sep="?"; [[ "$path" == *"?"* ]] && sep="&"
    # Unwind to the dashboard first so this shot starts from the same place
    # every time. Skipped for the dashboard shot itself, which IS that state.
    if [[ "$path" != "$DASHBOARD_PATH" ]]; then reset_to_dashboard "$lang"; fi
    open_url "${SCHEME}://${path}${sep}scLang=${lang}"
    sleep "${SHOTS_PANEL_SETTLE:-9}"
    shoot "$devdir" "$lang" "$key"
  done
}

status_bar_ios() {
  xcrun simctl status_bar booted override \
    --time "9:41" --batteryLevel 100 --batteryState charged \
    --cellularBars 4 --wifiBars 3 --dataNetwork wifi
}

# SHOTS_WIFI=hide drops the wifi glyph. The tablet AVDs render the demo wifi
# slot twice (two identical triangles) and hiding is the only variant that
# clears the duplicate; the phone renders it once, so it keeps the icon.
status_bar_android() {
  local wifi="${SHOTS_WIFI:-show}"
  local B=(adb shell am broadcast -a com.android.systemui.demo)
  adb shell settings put global sysui_demo_allowed 1 >/dev/null
  # Demo mode does not suppress Safety Center's status icons (the "set a screen
  # lock" shield), so snooze those notifications outright. Only the
  # |android|2345| safety-center keys actually render an icon.
  # `|| true`: with `set -o pipefail` a grep that matches nothing (the common
  # case, no safety-center notification posted) would abort the whole run.
  adb shell cmd notification list 2>/dev/null | tr -d '\r' | grep '|android|2345|' | while read -r k; do
    [[ -n "$k" ]] && adb shell "cmd notification snooze --for 86400000 '$k'" >/dev/null 2>&1
  done || true
  # exit first: a satellite hide is ignored when demo mode is already active.
  "${B[@]}" -e command exit >/dev/null
  "${B[@]}" -e command enter >/dev/null
  "${B[@]}" -e command clock -e hhmm 0941 >/dev/null
  "${B[@]}" -e command battery -e level 100 -e plugged false >/dev/null
  if [[ "$wifi" == "hide" ]]; then
    # airplane hide keeps the plane glyph away on the tablets, which are put
    # into airplane mode so SystemUI stops drawing its out-of-service icon.
    "${B[@]}" -e command network -e wifi hide -e airplane hide >/dev/null
  else
    # `fully true` marks the network validated, otherwise the wifi glyph carries
    # the "no internet" exclamation because the AVD has no upstream.
    "${B[@]}" -e command network -e wifi show -e level 4 -e fully true >/dev/null
  fi
  "${B[@]}" -e command network -e mobile hide >/dev/null
  "${B[@]}" -e command network -e sims hide >/dev/null
  # Last network command on purpose: the tablet AVDs fall back to a satellite glyph when mobile/wifi are hidden.
  "${B[@]}" -e command network -e satellite hide >/dev/null
  "${B[@]}" -e command notifications -e visible false >/dev/null
  "${B[@]}" -e command status -e volume hide -e bluetooth hide -e location hide \
      -e alarm hide -e sync hide -e tty hide -e eri hide -e mute hide \
      -e speakerphone hide -e zen hide -e cast hide -e hotspot hide >/dev/null
}

capture_group() { # $1 = device output dir label, $2.. = languages of one group
  local devdir="$1"; shift
  (($#)) || return 0
  establish_direction "$1"
  # A cold launch drops the status bar override, so re-assert it per group.
  if [[ "$PLATFORM" == "ios" ]]; then status_bar_ios; else status_bar_android; fi
  local lang
  for lang in "$@"; do
    capture_lang "$devdir" "$lang"
  done
}

# Languages are captured in two direction groups rather than in LANGS order, so
# the expensive cold-relaunch dance runs twice per device instead of once per
# language. Within a group nothing relaunches, so the fast deep-link path is
# unchanged; only the boundary between the groups costs anything.
capture_for_device() { # $1 = device output dir label
  local devdir="$1"
  echo "== device: $devdir =="
  local ltr=() rtl=() lang
  for lang in "${LANGS[@]}"; do
    if is_rtl_lang "$lang"; then rtl+=("$lang"); else ltr+=("$lang"); fi
  done
  # ${arr[@]+"${arr[@]}"}: macOS ships bash 3.2, where an empty array expanded
  # under `set -u` is an unbound-variable error.
  capture_group "$devdir" ${ltr[@]+"${ltr[@]}"}
  capture_group "$devdir" ${rtl[@]+"${rtl[@]}"}
}

PLATFORM="${1:-ios}"
select_shots || exit 1
if [[ "$PLATFORM" == iphone || "$PLATFORM" == ipad ]]; then PLATFORM_DEV="$PLATFORM"; PLATFORM=ios; fi
case "${PLATFORM_DEV:-$PLATFORM}" in
  iphone) capture_for_device "iphone" ;;
  ipad) capture_for_device "ipad" ;;
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
    # Output profile label: 2nd arg, or $SHOTS_PROFILE, so the same android pass
    # can write the phone and the two tablet AVDs into separate raw/ folders
    # instead of overwriting one another. Defaults to the historical label, so
    # `store-shots.sh android` keeps behaving exactly as before.
    capture_for_device "${2:-${SHOTS_PROFILE:-android-phone}}"
    ;;
  *)
    echo "usage: $0 [ios|iphone|ipad|android] [output-profile]" >&2; exit 1;;
esac

echo "Done. Raw shots in ./$OUT/ — feed them to the hypershots composite (Faz 3)."
