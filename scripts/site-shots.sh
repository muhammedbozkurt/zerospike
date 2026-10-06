#!/usr/bin/env bash
#
# site-shots.sh: store panels (zerospike-store/pipeline/out-v2) -> greeneyeapp-site web screenshots.
#
#   out-v2/<lang>/iphone/NN-<key>.png         -> <site>/assets/zerospike/<lang>/shots/NN.png
#   out-v2/<lang>/android-phone/NN-<key>.png  -> <site>/assets/zerospike/<lang>/android/NN.png
#
# NN = 01..08 (ring, bodymap, widgets, food, insights, spike, takip, reminders). watch/ is never
# touched, out-v2 has no source for it. A language missing from out-v2 is reported and skipped.
#
# Each panel is resampled to SITE_SHOTS_WIDTH px with sips (height follows the source aspect,
# rounded), then recompressed to an 8-bit palette PNG through sharp from the store pipeline's own
# node_modules. The palette pass is what keeps a panel near 250 KB, the format the site set already
# used: sips alone writes ~850 KB per iPhone panel. Without sharp the sips output is written as is
# and the size report names every file over the limit.
#
# Idempotent: output is built in a work dir and moved over the site file only when the bytes differ,
# so a second run writes nothing and leaves every mtime alone. Nothing is ever deleted.
#
# Usage:  scripts/site-shots.sh            # all nine languages
#         scripts/site-shots.sh tr en      # subset
# Env:    SITE_ROOT            site checkout (default ../greeneyeapp-site)
#         SITE_SHOTS_SRC       panel source (default zerospike-store/pipeline/out-v2)
#         SITE_SHOTS_WIDTH     output width in px (default 780)
#         SITE_SHOTS_LIMIT_KB  size report threshold (default 400)
#         SITE_SHOTS_PALETTE   0 skips the palette pass (default 1)
#         SITE_SHOTS_SHARP     sharp module dir (default pipeline/node_modules/sharp)
#         SITE_SHOTS_WORK      scratch dir (default $TMPDIR/zerospike-site-shots)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${SITE_SHOTS_SRC:-$ROOT/zerospike-store/pipeline/out-v2}"
SITE="${SITE_ROOT:-$ROOT/../greeneyeapp-site}"
WIDTH="${SITE_SHOTS_WIDTH:-780}"
LIMIT_KB="${SITE_SHOTS_LIMIT_KB:-400}"
PALETTE="${SITE_SHOTS_PALETTE:-1}"
SHARP_DIR="${SITE_SHOTS_SHARP:-$ROOT/zerospike-store/pipeline/node_modules/sharp}"
WORK="${SITE_SHOTS_WORK:-${TMPDIR:-/tmp}/zerospike-site-shots}"

ALL_LANGS=(tr en de fr es it pt ar ja)
PANELS=(01 02 03 04 05 06 07 08)
# source profile : site folder
TARGETS=("iphone:shots" "android-phone:android")

case "${1:-}" in
  -h|--help) echo "usage: scripts/site-shots.sh [lang ...]   (languages: ${ALL_LANGS[*]})"; exit 0 ;;
esac

command -v sips >/dev/null 2>&1 || { echo "sips not found (macOS only)" >&2; exit 1; }
[[ -d "$SRC" ]] || { echo "source dir not found: $SRC" >&2; exit 1; }
[[ -d "$SITE/assets/zerospike" ]] || { echo "site assets dir not found: $SITE/assets/zerospike" >&2; exit 1; }
SITE="$(cd "$SITE" && pwd)"
ASSETS="$SITE/assets/zerospike"

if (($#)); then
  LANGS=("$@")
  for l in "$@"; do
    case " ${ALL_LANGS[*]} " in
      *" $l "*) ;;
      *) echo "unknown language '$l'. Valid: ${ALL_LANGS[*]}" >&2; exit 2 ;;
    esac
  done
else
  LANGS=("${ALL_LANGS[@]}")
fi

MODE="sips"
if [[ "$PALETTE" == 1 ]]; then
  if command -v node >/dev/null 2>&1 && [[ -f "$SHARP_DIR/package.json" ]]; then
    MODE="sips+palette"
  else
    echo "warning: sharp not found at $SHARP_DIR, writing plain sips output" >&2
  fi
fi
mkdir -p "$WORK"

dims() { # $1 = png ; prints "W H", or nothing when unreadable
  sips -g pixelWidth -g pixelHeight "$1" 2>/dev/null \
    | awk '/pixelWidth/{w=$2} /pixelHeight/{h=$2} END{if (w != "" && h != "") print w, h}' || true
}

# sips exits 0 even when it fails, so every output is validated by its pixel size instead.
palettize() { # $@ = png files, rewritten in place
  node - "$SHARP_DIR" "$@" <<'JS'
const sharp = require(process.argv[2]);
const fs = require('fs');
sharp.cache(false);
(async () => {
  for (const f of process.argv.slice(3)) {
    const buf = await sharp(f)
      .png({ palette: true, quality: 100, colours: 256, dither: 1.0, effort: 10, compressionLevel: 9 })
      .toBuffer();
    fs.writeFileSync(f, buf);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
JS
}

written=0
same=0
failed=0
max_bytes=0
max_label=""
missing_langs=()
problems=()
big=()

echo "site-shots: mode=$MODE width=$WIDTH limit=${LIMIT_KB}KB"
echo "  src  $SRC"
echo "  site $ASSETS"

for lang in "${LANGS[@]}"; do
  if [[ ! -d "$SRC/$lang" ]]; then
    missing_langs+=("$lang")
    echo "$lang: no folder in out-v2, skipped"
    continue
  fi

  tmps=(); dests=(); exps=(); labels=(); subs=()
  for target in "${TARGETS[@]}"; do
    profile="${target%%:*}"
    sub="${target#*:}"
    for nn in "${PANELS[@]}"; do
      label="$lang/$sub/$nn"
      matches=("$SRC/$lang/$profile/$nn"-*.png)
      if [[ ! -f "${matches[0]}" ]]; then
        problems+=("$label: source missing ($profile/$nn-*.png)")
        continue
      fi
      if ((${#matches[@]} > 1)); then
        problems+=("$label: ${#matches[@]} sources match $profile/$nn-*.png")
        continue
      fi
      read -r w h <<< "$(dims "${matches[0]}")"
      if [[ -z "$w" || -z "$h" ]]; then
        problems+=("$label: source unreadable (${matches[0]})")
        continue
      fi
      th=$(( (WIDTH * h + w / 2) / w ))
      tmp="$WORK/$lang.$sub.$nn.png"
      : > "$tmp"
      sips_out="$(sips -s format png -z "$th" "$WIDTH" "${matches[0]}" --out "$tmp" 2>&1 || true)"
      if [[ "$(dims "$tmp")" != "$WIDTH $th" ]]; then
        problems+=("$label: resample failed: $(echo "$sips_out" | tr '\n' ' ')")
        continue
      fi
      tmps+=("$tmp"); dests+=("$ASSETS/$lang/$sub/$nn.png"); exps+=("$WIDTH $th"); labels+=("$label"); subs+=("$sub")
    done
  done

  if [[ "$MODE" == "sips+palette" ]] && ((${#tmps[@]} > 0)); then
    if ! palettize "${tmps[@]}"; then
      problems+=("$lang: palette pass failed, language left untouched")
      failed=$((failed + ${#tmps[@]}))
      continue
    fi
  fi

  l_written=0; l_same=0; l_shots=0; l_android=0
  for ((i = 0; i < ${#tmps[@]}; i++)); do
    tmp="${tmps[$i]}"; dest="${dests[$i]}"; label="${labels[$i]}"
    if [[ "$(dims "$tmp")" != "${exps[$i]}" ]]; then
      problems+=("$label: output size check failed")
      failed=$((failed + 1))
      continue
    fi
    if [[ -f "$dest" ]] && cmp -s "$tmp" "$dest"; then
      l_same=$((l_same + 1))
      : > "$tmp"
    else
      mkdir -p "$(dirname "$dest")"
      chmod 644 "$tmp"
      if ! mv -f "$tmp" "$dest"; then
        problems+=("$label: could not write $dest")
        failed=$((failed + 1))
        continue
      fi
      l_written=$((l_written + 1))
    fi
    if [[ "${subs[$i]}" == "shots" ]]; then l_shots=$((l_shots + 1)); else l_android=$((l_android + 1)); fi
    bytes="$(wc -c < "$dest" | tr -d ' ')"
    if ((bytes > max_bytes)); then max_bytes=$bytes; max_label="$label"; fi
    if ((bytes > LIMIT_KB * 1024)); then big+=("$label $((bytes / 1024))KB"); fi
  done
  written=$((written + l_written))
  same=$((same + l_same))
  echo "$lang: shots ${l_shots}/${#PANELS[@]}, android ${l_android}/${#PANELS[@]} (written $l_written, unchanged $l_same)"
done

echo
echo "total: $((written + same)) ok (written $written, unchanged $same), failed $failed"
echo "largest: $((max_bytes / 1024))KB ${max_label}"
if ((${#big[@]} > 0)); then echo "over ${LIMIT_KB}KB: ${big[*]}"; else echo "over ${LIMIT_KB}KB: none"; fi
if ((${#missing_langs[@]} > 0)); then echo "missing languages: ${missing_langs[*]}"; else echo "missing languages: none"; fi
if ((${#problems[@]} > 0)); then
  echo "problems:"
  for p in "${problems[@]}"; do echo "  $p"; done
  exit 1
fi
((failed == 0)) || exit 1
