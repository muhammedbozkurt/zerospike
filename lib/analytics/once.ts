/**
 * Remembers which keys already fired in this app run. Used for funnel step
 * events: going back (Android hardware back from the first quiz step to the
 * welcome page) must not log the step a second time, or the funnel counts the
 * same device twice at that step and the order of the rows misleads.
 */
export function createOnceGate(): (key: string) => boolean {
  const seen = new Set<string>();
  return (key) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}
