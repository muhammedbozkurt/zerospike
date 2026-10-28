/**
 * The dashboard reads the Health import switch when the profile or the import
 * gate changes. The switch can also change while the dashboard sits under
 * another screen (Settings > Data sources turns it on after the CGM pick), so
 * coming back to the dashboard re-reads the stored value and reconciles. Pure,
 * so the decision is testable without a renderer.
 *
 * - `cgmOn` null: the first read has not landed, its own effect settles it.
 * - `syncing`: a connect or import owns the switch right now (the card shows it
 *   on optimistically before the grant), leave it alone.
 * - Not allowed to import (free, not in CGM mode): the card is a Pro card, the
 *   stored value is not shown.
 */
export type FlagRefresh = "on" | "off" | "none";

export function decideFlagRefresh(i: {
  allowed: boolean;
  cgmOn: boolean | null;
  syncing: boolean;
  saved: boolean;
}): FlagRefresh {
  if (!i.allowed || i.cgmOn === null || i.syncing) return "none";
  if (i.saved === i.cgmOn) return "none";
  return i.saved ? "on" : "off";
}
