/**
 * The one place the "which period does this reading belong to" rule lives.
 * Dependency-free (no DB, no i18n, no RN) so it can be imported from either
 * side and from a plain Node test.
 *
 * An imported reading is an observation, not a guess about when it was taken
 * relative to a meal: assigning it a period tag would make a prediction look
 * like a fact the user never actually told the app. So a Health import always
 * gets "unset" - never a guessed tag, whatever the clock says.
 */

import type { PeriodTag } from "./db/types";

/** Where a sugar_logs row is being written from, for the purpose of deciding
 *  its period_tag. */
export type PeriodTagSource =
  | "manual_entry"
  | "health_import"
  | "widget_quick_add"
  | "backdated";

/** The tags a user can actually pick, in the order they are offered.
 *  "unset" is deliberately NOT here: it is never a choice, only the value an
 *  import leaves behind. */
export const PERIOD_TAGS: readonly PeriodTag[] = [
  "fasting",
  "pre_meal",
  "post_meal_2h",
  "bedtime",
  "manual",
];

/**
 * What a brand-new glucose entry opens on when nothing in its context says
 * otherwise: no label. Defaulting to "fasting" put an afternoon reading into
 * the fasting averages unless the user noticed and changed it. A context that
 * knows the period (the post-meal 2-hour reminder) passes its own.
 */
export const DEFAULT_NEW_READING_PERIOD: PeriodTag = "unset";

/**
 * The period_tag a new row should be written with.
 *
 * - health_import: always "unset", regardless of `opts` - an imported reading
 *   carries no period at all (see the file header).
 * - manual_entry / widget_quick_add: `opts.explicit` if the user picked one
 *   before saving, otherwise DEFAULT_NEW_READING_PERIOD (no label; the user can still
 *   pick one on the entry screen before it is saved).
 * - backdated: `opts.explicit` if the user picked one, otherwise "unset" -
 *   there is no clock-based guess for an entry dated in the past.
 */
export function autoPeriodTagFor(
  src: PeriodTagSource,
  opts: { hour?: number; explicit?: PeriodTag | null } = {}
): PeriodTag {
  if (src === "health_import") return "unset";
  if (src === "manual_entry" || src === "widget_quick_add") {
    return opts.explicit ?? DEFAULT_NEW_READING_PERIOD;
  }
  // src === "backdated"
  return opts.explicit ?? "unset";
}
