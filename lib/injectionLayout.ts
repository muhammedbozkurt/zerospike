/** Injection screen tablet layout: map on the left, form/history on the right.
 *  Pure so the breakpoints are testable without rendering. The wide flag comes
 *  from lib/useLayout (shortest side >= 600dp); the extra 700dp window-width
 *  floor is the same one insights uses for its narrow-tablet fallback. */
export const TWO_COLUMN_MIN_WIDTH = 700;
/** Readable cap for one column's content (excluding the 16pt gutters). */
export const TWO_COLUMN_CONTENT_MAX = 560;
const GUTTER = 16;

export type InjectionColumns = {
  twoCol: boolean;
  /** Extra symmetric padding that centres the capped content in a column. */
  gap: number;
};

export function injectionColumns(width: number, isWide: boolean): InjectionColumns {
  const twoCol = isWide && width >= TWO_COLUMN_MIN_WIDTH;
  if (!twoCol) return { twoCol: false, gap: 0 };
  const colWidth = width / 2;
  return {
    twoCol: true,
    gap: Math.max(0, Math.floor((colWidth - GUTTER * 2 - TWO_COLUMN_CONTENT_MAX) / 2)),
  };
}
