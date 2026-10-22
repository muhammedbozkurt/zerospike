import type { GlucoseUnit } from "./db/types";
import {
  formatGlucose,
  glucoseUnitLabel,
  statusLabelKey,
  type GlucoseStatus,
} from "./glucose";

/**
 * Screen-reader label of a glucose journal row: "value unit, context, status,
 * time". The status word comes from the same statusLabelKey vocabulary the chip,
 * the entry sheet and the Today card use, so a reader hears what a sighted user
 * sees and the colour is never the only cue. Replaces the separate "low" badge
 * text, which the status already says.
 */
export function glucoseRowLabel(args: {
  t: (key: string) => string;
  mgdl: number;
  unit: GlucoseUnit;
  status: GlucoseStatus;
  sourceLabel: string;
  timeText: string;
  /** True when the row has no period yet and a tap can assign one. */
  canAddPeriod: boolean;
}): string {
  const { t, mgdl, unit, status, sourceLabel, timeText, canAddPeriod } = args;
  return [
    `${formatGlucose(mgdl, unit)} ${glucoseUnitLabel(unit)}`,
    sourceLabel,
    t(statusLabelKey(status)),
    timeText,
    canAddPeriod ? t("journal.addPeriodTag") : null,
  ]
    .filter(Boolean)
    .join(", ");
}
