import type { ThanksEntitlement, ThanksPeriod } from "./detect";

function periodOf(v: unknown): ThanksPeriod {
  switch (String(v ?? "").toUpperCase()) {
    case "TRIAL":
      return "trial";
    case "INTRO":
      return "intro";
    case "NORMAL":
      return "normal";
    default:
      return "unknown";
  }
}

function isoMs(v: unknown): number | null {
  if (typeof v !== "string" || v === "") return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * RevenueCat's active EntitlementInfo (or undefined when there is none) as the
 * facts the thank-you moments need. Only periodType, expirationDate,
 * productIdentifier, billingIssueDetectedAt and ownershipType are read.
 * Pure, so the mapping is testable against RC-shaped objects.
 */
export function mapEntitlement(ent: unknown): ThanksEntitlement {
  if (ent === null || typeof ent !== "object") {
    return {
      active: false,
      periodType: "unknown",
      expiresAt: null,
      productId: null,
      billingIssueDetectedAt: null,
      familyShared: false,
    };
  }
  const e = ent as Record<string, unknown>;
  return {
    active: true,
    periodType: periodOf(e.periodType),
    expiresAt: isoMs(e.expirationDate),
    productId: typeof e.productIdentifier === "string" && e.productIdentifier !== "" ? e.productIdentifier : null,
    billingIssueDetectedAt: isoMs(e.billingIssueDetectedAt),
    familyShared: String(e.ownershipType ?? "").toUpperCase() === "FAMILY_SHARED",
  };
}
