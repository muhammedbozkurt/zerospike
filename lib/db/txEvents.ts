/**
 * Health-store mirror events of writes made inside inDbTransaction
 * (lib/db/meals.ts) wait for the COMMIT: a rolled-back write must never reach
 * the health store. Kept dependency-free so the db modules that only need the
 * transaction wrapper do not pull in the injection layer.
 */
let deferredEvents: (() => void)[] | null = null;

/** Fires now, or after the open transaction commits. */
export function afterCommit(fire: () => void): void {
  if (deferredEvents) deferredEvents.push(fire);
  else fire();
}
export function deferInjectionEvents(): void {
  deferredEvents = [];
}
export function flushInjectionEvents(): void {
  const queue = deferredEvents;
  deferredEvents = null;
  queue?.forEach((fire) => fire());
}
export function discardInjectionEvents(): void {
  deferredEvents = null;
}
