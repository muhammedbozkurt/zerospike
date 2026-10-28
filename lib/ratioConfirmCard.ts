import type { GlucoseUnit } from "./db/types";
import {
  calcFiguresAllowed,
  calcSetupPrefilled,
  ratioSetMatchesStored,
  type RatioFields,
} from "./calcSetup";

/**
 * What the calculator tells a user about their ratios, decided in one pure place
 * so the three surfaces (the calculator, the ratios sheet, Profile and Targets)
 * agree and scripts/ratioConfirmCard.test.ts can run it under plain Node.
 *
 * This file only chooses which card to show. It never supplies a number and it
 * never grants the confirmation: a figure appears only when calcFiguresAllowed
 * (lib/calcSetup.ts) says so, which is exactly the "confirmed" state here.
 */

type RatioProfile = Parameters<typeof calcFiguresAllowed>[0];

/** none: no ratios of the user's own. unconfirmed: all four entered, no
 *  confirmation. confirmed: entered AND confirmed (the only state with a figure). */
export type RatioConfirmState = "none" | "unconfirmed" | "confirmed";

export function ratioConfirmState(profile: RatioProfile): RatioConfirmState {
  if (calcFiguresAllowed(profile)) return "confirmed";
  return calcSetupPrefilled(profile) ? "unconfirmed" : "none";
}

/** The card the calculator shows in place of a figure; null once confirmed. */
export type RatioStateCardKind = "enter" | "confirm";

export function ratioStateCardKind(state: RatioConfirmState): RatioStateCardKind | null {
  if (state === "none") return "enter";
  if (state === "unconfirmed") return "confirm";
  return null;
}

/** A calculated figure is visible only in the confirmed state. */
export function ratioFiguresVisible(state: RatioConfirmState): boolean {
  return state === "confirmed";
}

/** How the ratios sheet opens from the state card: with the confirmation card
 *  emphasised only when the ratios are already entered. */
export function ratioSetupOpenOptions(state: RatioConfirmState): { emphasizeConfirm: boolean } {
  return { emphasizeConfirm: state === "unconfirmed" };
}

/**
 * Whether the confirmation box shows ticked: derived from the stored profile,
 * never from a local flag, so it is never given on the user's behalf and can
 * never disagree with the database. Ticked only while the profile holds
 * ratios_confirmed 1 AND the numbers on screen are the stored ones (an edit
 * withdraws the confirmation; typing "8," over "8" is not an edit).
 */
export function ratioCardChecked(
  profile: RatioProfile,
  draft: RatioFields,
  unit: GlucoseUnit
): boolean {
  return !!profile && profile.ratios_confirmed === 1 && ratioSetMatchesStored(profile, draft, unit);
}

/** The inline line "the calculation is not shown until you confirm". */
export function showUntilConfirmNote(input: { complete: boolean; checked: boolean }): boolean {
  return input.complete && !input.checked;
}

/** The confirmation card takes the accent border when it is waiting on the user
 *  (ratios complete, box empty) or when it was opened on purpose. */
export function confirmCardEmphasized(input: {
  complete: boolean;
  checked: boolean;
  emphasized: boolean;
}): boolean {
  return !input.checked && (input.emphasized || input.complete);
}

/** After Save: remind only when the ratios are all entered and not confirmed. */
export function saveNeedsConfirmReminder(input: { complete: boolean; confirmed: boolean }): boolean {
  return input.complete && !input.confirmed;
}
