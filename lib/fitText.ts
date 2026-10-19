/**
 * Single-line title fitting without adjustsFontSizeToFit (Android clips that
 * silently). Pure: the width of a string is estimated from per-script em
 * factors, then the font size steps down until it fits or hits the floor.
 * The caller still sets numberOfLines={1} so the floor degrades to an ellipsis.
 */

const CJK = /[぀-ヿ㐀-鿿＀-￯]/;
const ARABIC = /[؀-ۿ]/;

/** Em width of one glyph for a heavy (800) UI weight. Deliberately on the wide side. */
export function glyphEm(ch: string): number {
  if (CJK.test(ch)) return 1;
  if (ARABIC.test(ch)) return 0.6;
  if (ch === " ") return 0.3;
  if (/[A-Z]/.test(ch)) return 0.7;
  if (/[iljtfI.,'!]/.test(ch)) return 0.34;
  if (/[mwMW]/.test(ch)) return 0.92;
  return 0.6;
}

export function estimateTextWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const ch of text) em += glyphEm(ch);
  return em * fontSize;
}

/**
 * Largest size in [minSize, maxSize] (step apart) whose estimated width fits
 * `availableWidth`. `fontScale` is the OS text scale (it enlarges the rendered
 * glyphs, so the budget shrinks by the same factor). Never below minSize.
 */
export function fitFontSize(opts: {
  text: string;
  availableWidth: number;
  maxSize: number;
  minSize: number;
  step?: number;
  fontScale?: number;
}): number {
  const { text, availableWidth, maxSize, minSize } = opts;
  const step = opts.step && opts.step > 0 ? opts.step : 1;
  const scale = opts.fontScale && opts.fontScale > 0 ? opts.fontScale : 1;
  if (availableWidth <= 0) return minSize;
  for (let size = maxSize; size > minSize; size -= step) {
    if (estimateTextWidth(text, size) * scale <= availableWidth) return size;
  }
  return minSize;
}
