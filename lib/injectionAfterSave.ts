/**
 * Pure rules for what happens right after an injection is saved
 * (app/(tabs)/injection.tsx): where the user lands, and where the new row sits
 * in the history list so it can be scrolled to and highlighted.
 */

/** How long the freshly saved row stays highlighted in the history. */
export const SAVED_HIGHLIGHT_MS = 1500;

export type AfterSaveTarget = "today" | "history";

/** The dashboard quick-add opens this tab with compose=1; `from=today` is the
 *  explicit spelling. Either means "I started on Today", so a save returns
 *  there instead of keeping the user in the log. */
export function cameFromToday(params: { from?: string; compose?: string }): boolean {
  return params.from === "today" || (params.compose != null && params.compose !== "");
}

export function afterSaveTarget(fromToday: boolean): AfterSaveTarget {
  return fromToday ? "today" : "history";
}

export interface SectionLocation {
  sectionIndex: number;
  itemIndex: number;
}

/** Position of an injection in day-grouped history sections, or null when it is
 *  not in the visible slice (SectionList.scrollToLocation counts the section
 *  header as index 0 of its section only when asked to, so item indexes here
 *  are plain row indexes). */
export function findInjectionLocation(
  sections: ReadonlyArray<{ data: ReadonlyArray<{ id: string }> }>,
  id: string
): SectionLocation | null {
  for (let s = 0; s < sections.length; s++) {
    const i = sections[s].data.findIndex((row) => row.id === id);
    if (i >= 0) return { sectionIndex: s, itemIndex: i };
  }
  return null;
}
