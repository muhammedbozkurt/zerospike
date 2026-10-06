/**
 * "Delete my server records" (Settings > Data > Privacy): what the request looks
 * like, what each answer means, and the order of the steps around it. Pure and
 * dependency-free so scripts/analyticsConsent.test.ts pins it under plain node;
 * the network call itself is postDeleteDevice in ./transport.
 *
 * The server function deletes everything it holds under this installation ID:
 * usage events, the Spike counter and its technical log, and the subscription
 * event records, which it also matches on the RevenueCat app user id, because
 * the installation ID only rides on the events RevenueCat reported while usage
 * analytics was on. The journal on the device is never touched. The installation
 * ID itself stays: a new one would hand out a fresh daily Spike allowance.
 */

export type DeleteResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "no_device_id" | "rejected" | "unavailable" };

export interface DeleteRequest {
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

/** The RevenueCat app user id travels in this header, next to x-device-id. */
export const APP_USER_ID_HEADER = "x-rc-app-user-id";

// What the function accepts: visible ASCII, no spaces, at most 128 characters
// (supabase/functions/delete-device/index.ts holds the same pattern). RevenueCat's
// anonymous ids ("$RCAnonymousID:" and 32 hex digits) are well inside it.
const APP_USER_ID = /^[\x21-\x7e]{1,128}$/;

/** True for a RevenueCat app user id the function will take; anything else is left out of the request. */
export function isSendableAppUserId(value: unknown): value is string {
  return typeof value === "string" && APP_USER_ID.test(value);
}

/**
 * The installation ID travels as x-device-id, the same header `track` reads, and
 * the RevenueCat app user id (when the SDK has one) as x-rc-app-user-id. The body
 * is empty on purpose.
 */
export function buildDeleteRequest(deviceId: string, appUserId?: string | null): DeleteRequest {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-device-id": deviceId,
  };
  if (isSendableAppUserId(appUserId)) headers[APP_USER_ID_HEADER] = appUserId;
  return { method: "POST", headers, body: "{}" };
}

/**
 * 2xx: deleted. 400, 401, 403, 404, 405, 413 and 422: this request will not be
 * accepted however often it is repeated. Anything else (429, 5xx, a gateway
 * error) is the server being unavailable; trying again later is the right move.
 */
export function classifyDeleteStatus(status: number): DeleteResult {
  if (status >= 200 && status < 300) return { ok: true };
  if ([400, 401, 403, 404, 405, 413, 422].includes(status)) {
    return { ok: false, reason: "rejected" };
  }
  return { ok: false, reason: "unavailable" };
}

/**
 * The steps around the request, in order:
 *  1. uploads are paused and a batch already on its way is allowed to land, so
 *     nothing can reach the server behind the deletion;
 *  2. the outbox is emptied, so nothing logged earlier is uploaded after it;
 *  3. the server is asked to delete;
 *  4. after a success the outbox is emptied again, for whatever was logged while
 *     the request ran, and the other holder of the installation's data (Firebase's
 *     app instance) is told to forget it;
 *  5. uploads go on, whatever the answer was.
 * A failed deletion leaves the outbox as the first clear left it and does not
 * touch Firebase. A pause or a Firebase reset that fails never stops the deletion
 * or changes its result.
 */
export async function runDeleteFlow(deps: {
  /** Stops the uploads and resolves once nothing is in flight; the result lets them go on. */
  pauseSending?(): Promise<() => void>;
  clearQueue(): Promise<void>;
  post(): Promise<DeleteResult>;
  /** Runs only after a successful deletion. */
  afterDeleted?(): Promise<void>;
}): Promise<DeleteResult> {
  let resume: (() => void) | undefined;
  try {
    resume = await deps.pauseSending?.();
  } catch {
    // an uploader that cannot be paused must not keep the person from deleting
  }
  try {
    await deps.clearQueue();
    const result = await deps.post();
    if (result.ok) {
      await deps.clearQueue();
      try {
        await deps.afterDeleted?.();
      } catch {
        // the server records are gone either way
      }
    }
    return result;
  } finally {
    resume?.();
  }
}
