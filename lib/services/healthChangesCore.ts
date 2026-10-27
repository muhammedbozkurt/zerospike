/**
 * Health Connect's changes feed, drained to the end. Dependency-free (no
 * react-native import) so scripts/opus5aImport.test.ts can drive it.
 *
 * getChanges hands back one batch and `hasMore` when another follows. Stopping
 * at the first batch would drop the deletions of the later ones and still move
 * the token past them, so a reading the user deleted in Health Connect would
 * stay in the journal for good.
 */

export interface ChangesPage {
  nextChangesToken?: string;
  changesTokenExpired?: boolean;
  hasMore?: boolean;
  upsertionChanges?: unknown[];
  deletionChanges?: { recordId?: unknown }[];
}

export interface DrainedChanges {
  /** The token to store once the caller handled the result. */
  next: string | undefined;
  expired: boolean;
  changed: boolean;
  deletedIds: string[];
}

/** A runaway guard, not a limit anyone reaches: 100 batches of changes. */
const MAX_CHANGE_PAGES = 100;

export async function drainChanges(
  fetchPage: (token: string) => Promise<ChangesPage>,
  startToken: string,
  maxPages: number = MAX_CHANGE_PAGES
): Promise<DrainedChanges> {
  let token = startToken;
  let next: string | undefined;
  let changed = false;
  const deleted = new Set<string>();
  for (let i = 0; i < maxPages; i++) {
    const res = await fetchPage(token);
    if (res?.changesTokenExpired) return { next: res.nextChangesToken, expired: true, changed: true, deletedIds: [] };
    next = res?.nextChangesToken ?? next;
    if ((res?.upsertionChanges?.length ?? 0) > 0) changed = true;
    for (const d of res?.deletionChanges ?? []) {
      changed = true;
      const id = d?.recordId;
      if (typeof id === "string" && id.length > 0) deleted.add(id);
    }
    if (!res?.hasMore || !res.nextChangesToken) break;
    token = res.nextChangesToken;
  }
  return { next, expired: false, changed, deletedIds: [...deleted] };
}
