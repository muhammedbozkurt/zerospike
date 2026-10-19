/**
 * Does a bottom-tab label fit on one line? RN text metrics need a live
 * renderer, so this is a conservative per-glyph ESTIMATE (em widths of the
 * 600-weight system font), calibrated on the two labels measured on device
 * ("Tableau de bord" ~82.9pt, "Configurações" ~73.7pt at 11pt). No
 * react-native import: scripts/tabLabelFit.test.ts runs it in plain Node.
 */

export const TAB_LABEL_FONT_SIZE = 11;
/** Horizontal padding the tab bar keeps around a label, per side. */
const TAB_SIDE_PAD = 4;

const NARROW = new Set("ilj'’.,:;!|".split(""));
const SEMI = new Set("tfrI()".split(""));
const WIDE = new Set("mwMW".split(""));

function glyphEm(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if ((code >= 0x3000 && code <= 0x9fff) || (code >= 0xff00 && code <= 0xffef)) return 1;
  if (code >= 0x0600 && code <= 0x06ff) return 0.5;
  if (ch === " ") return 0.28;
  if (/[0-9]/.test(ch)) return 0.58;
  if (NARROW.has(ch)) return 0.28;
  if (SEMI.has(ch)) return 0.36;
  if (WIDE.has(ch)) return 0.86;
  if (ch !== ch.toLowerCase()) return 0.66;
  return 0.56;
}

/** Estimated single-line width in pt. Accents do not add width. */
export function estimateTabLabelWidth(
  label: string,
  fontSize: number = TAB_LABEL_FONT_SIZE,
  fontScale = 1
): number {
  const base = label.normalize("NFD").replace(/[̀-ͯ]/g, "");
  let em = 0;
  for (const ch of base) em += glyphEm(ch);
  return em * fontSize * fontScale;
}

/** Width one label may take: its equal share of the bar minus the side padding. */
export function tabLabelBudget(screenWidth: number, tabCount: number): number {
  return screenWidth / tabCount - TAB_SIDE_PAD * 2;
}

export function tabLabelFits(
  label: string,
  screenWidth: number,
  tabCount: number,
  fontScale = 1
): boolean {
  return estimateTabLabelWidth(label, TAB_LABEL_FONT_SIZE, fontScale) <= tabLabelBudget(screenWidth, tabCount);
}
