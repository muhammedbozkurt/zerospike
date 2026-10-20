/* Tema-bagimsiz sabit renkler: PDF raporu ve Android widget. lib/theme/tokens
 * canli tema getter'lari olduk, bu yuzden bu yuzeyler oradan renk okumaz.
 * Degerler P0 oncesi (cd0a140) koyu palet. */
export const FROZEN_GLUCOSE_COLORS = {
  low: "#ff5468",
  normal: "#22e39a",
  elevated: "#ffd23f",
  high: "#ffa02a",
  veryHigh: "#ff8a00",
} as const;

export const FROZEN_GLUCOSE_VERY_LOW = "#b3243b";

export const FROZEN_GLUCOSE_RICH = {
  low: "#ff5468",
  target: "#22e39a",
  high: "#ffd23f",
  wellAbove: "#ffa02a",
  veryHigh: "#ff8a00",
} as const;

export const FROZEN_THEME = {
  bg: { g1: "#080e14", g2: "#0f2029" },
  ink: "#eaf6fa",
  muted: "#89a3b0",
  accent: "#22c7e0",
  violet: "#7c5cff",
  caution: "#ffa02a",
} as const;

/* PDF beyaz kagitta basilir. Bilgi tasiyan metin/cizgi/nokta INK (beyazda 5,69:1);
 * FILL (beyazda 2,04:1) yalniz dekoratif serit ve yari saydam bant icindir. */
export const PDF_ACCENT_INK = "#087089";
export const PDF_ACCENT_FILL = "#22c7e0";
