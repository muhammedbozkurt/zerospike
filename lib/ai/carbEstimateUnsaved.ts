import type { EditableItem } from "./carbEstimateClient";

/**
 * The newest estimate result nobody added yet, kept in memory for this app session only (never stored on the
 * device): if the sheet goes away without the user choosing to discard, opening it again shows the same rows and
 * asks the server for nothing, so no second allowance is spent. A choice to discard, an add, a withdrawn consent,
 * a switched profile or an hour away ends it. A module of its own so the consent and profile code can clear it
 * without importing the estimate client.
 */
export const UNSAVED_ESTIMATE_TTL_MS = 60 * 60 * 1000;
let unsavedEstimate: { text: string; items: EditableItem[]; at: number } | null = null;

export function rememberUnsavedEstimate(text: string, items: readonly EditableItem[], now: number = Date.now()): void {
  unsavedEstimate = items.length > 0 ? { text, items: items.map((item) => ({ ...item })), at: now } : null;
}

export function recallUnsavedEstimate(now: number = Date.now()): { text: string; items: EditableItem[] } | null {
  if (!unsavedEstimate || now - unsavedEstimate.at > UNSAVED_ESTIMATE_TTL_MS || now < unsavedEstimate.at) {
    unsavedEstimate = null;
    return null;
  }
  return { text: unsavedEstimate.text, items: unsavedEstimate.items.map((item) => ({ ...item })) };
}

export function forgetUnsavedEstimate(): void {
  unsavedEstimate = null;
}
