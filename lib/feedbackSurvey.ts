/**
 * Pure rules behind the feedback sheet (components/feedback) and the one-time
 * cancellation survey: the request the `feedback` edge function accepts, how
 * its answers read, what the analytics event may carry, and when the survey is
 * due. Dependency-free so scripts/feedbackSurvey.test.ts runs under plain node;
 * the network call and the sheet live in ./feedbackClient and components/feedback.
 *
 * Free text and the e-mail address go to the function and nowhere else: never to
 * analytics, never to a log.
 */

// ---------------------------------------------------------------------------
// Vocabulary (the server's lists, supabase/functions/feedback/validate.ts)
// ---------------------------------------------------------------------------

export const USER_FEEDBACK_KINDS = ["suggestion", "bug", "other"] as const;
export const FEEDBACK_KINDS = [...USER_FEEDBACK_KINDS, "cancel_survey"] as const;
export const CANCEL_REASONS = [
  "expensive",
  "not_used",
  "missing_feature",
  "bug",
  "other_app",
  "other",
] as const;

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export type UserFeedbackKind = (typeof USER_FEEDBACK_KINDS)[number];
export type CancelReason = (typeof CANCEL_REASONS)[number];

export const MAX_MESSAGE_CHARS = 2000;
export const MAX_EMAIL_CHARS = 254;

// ---------------------------------------------------------------------------
// Draft validation and request body
// ---------------------------------------------------------------------------

export interface FeedbackDraft {
  kind: FeedbackKind;
  /** Only meaningful for cancel_survey; ignored for the other kinds. */
  reasonCode: CancelReason | null;
  message: string;
  email: string;
}

export type DraftProblem = "empty" | "bad_email";

// Same shape the server accepts: something@something.tld without spaces.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return value.length <= MAX_EMAIL_CHARS && EMAIL.test(value);
}

/** Trimmed, line breaks normalised, cut to the server's limit by code points. */
export function cleanMessage(value: string): string {
  const text = value.replace(/\r\n?/g, "\n").trim();
  const chars = Array.from(text);
  return chars.length > MAX_MESSAGE_CHARS ? chars.slice(0, MAX_MESSAGE_CHARS).join("").trim() : text;
}

/**
 * A suggestion, bug report or note needs text; the survey needs a reason or text.
 * The e-mail is optional but, when typed, must look like one.
 */
export function draftProblem(draft: FeedbackDraft): DraftProblem | null {
  const message = cleanMessage(draft.message);
  if (draft.kind === "cancel_survey") {
    if (!message && !draft.reasonCode) return "empty";
  } else if (!message) {
    return "empty";
  }
  const email = draft.email.trim();
  if (email && !isValidEmail(email)) return "bad_email";
  return null;
}

/** True when the send button may be pressed (an e-mail typo is reported on press). */
export function canSend(draft: FeedbackDraft): boolean {
  return draftProblem({ ...draft, email: "" }) === null;
}

export interface FeedbackContext {
  appVersion: string;
  platform: string;
  locale: string;
}

export interface FeedbackBody {
  kind: FeedbackKind;
  reason_code?: CancelReason;
  message?: string;
  contact_email?: string;
  app_version?: string;
  platform?: "ios" | "android";
  locale?: string;
}

const APP_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/;
const LOCALE = /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8}){0,3}$/;

/**
 * The JSON the function takes. Empty optional fields are left out, the reason is
 * sent only with the survey, and a context value the server would reject (an
 * unusual platform, a malformed version) is dropped instead of failing the whole
 * message.
 */
export function buildFeedbackBody(draft: FeedbackDraft, ctx: FeedbackContext): FeedbackBody {
  const body: FeedbackBody = { kind: draft.kind };
  if (draft.kind === "cancel_survey" && draft.reasonCode) body.reason_code = draft.reasonCode;
  const message = cleanMessage(draft.message);
  if (message) body.message = message;
  const email = draft.email.trim();
  if (email) body.contact_email = email;
  if (APP_VERSION.test(ctx.appVersion)) body.app_version = ctx.appVersion;
  if (ctx.platform === "ios" || ctx.platform === "android") body.platform = ctx.platform;
  if (LOCALE.test(ctx.locale)) body.locale = ctx.locale;
  return body;
}

export const FEEDBACK_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface FeedbackRequest {
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

/** The installation id rides in x-device-id, like on every other function. */
export function buildFeedbackRequest(deviceId: string, body: FeedbackBody): FeedbackRequest {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-device-id": deviceId },
    body: JSON.stringify(body),
  };
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

export type FeedbackFailure =
  | "not_configured"
  | "no_device_id"
  | "rate_limited"
  | "rejected"
  | "unavailable";

export type FeedbackResult = { ok: true } | { ok: false; reason: FeedbackFailure };

/**
 * 2xx: stored. 429: too many sent lately, try later. 400 and 413: this exact
 * message will not be accepted. Anything else (5xx, gateway) is the server being
 * unavailable. In every failure the typed text stays on screen.
 */
export function classifyFeedbackStatus(status: number): FeedbackResult {
  if (status >= 200 && status < 300) return { ok: true };
  if (status === 429) return { ok: false, reason: "rate_limited" };
  if (status === 400 || status === 413) return { ok: false, reason: "rejected" };
  return { ok: false, reason: "unavailable" };
}

/** Maps a failure to the i18n key of its short message. */
export function failureMessageKey(reason: FeedbackFailure): string {
  switch (reason) {
    case "rate_limited":
      return "feedback.errorRateLimited";
    case "rejected":
      return "feedback.errorRejected";
    default:
      return "feedback.errorNetwork";
  }
}

// ---------------------------------------------------------------------------
// Analytics: kind and reason only
// ---------------------------------------------------------------------------

export interface FeedbackEventProps {
  kind: FeedbackKind;
  reason_code: CancelReason | "none";
}

/** The whole payload of feedback_sent. The text and the e-mail are not in it by construction. */
export function feedbackEventProps(draft: FeedbackDraft): FeedbackEventProps {
  return {
    kind: draft.kind,
    reason_code: draft.kind === "cancel_survey" && draft.reasonCode ? draft.reasonCode : "none",
  };
}

// ---------------------------------------------------------------------------
// Cancellation survey: detection, once-only flag, ordering against the winback
// ---------------------------------------------------------------------------

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

/** Whether Pro was on the last time we looked ("true" | "false"); absent before the first look. */
export const WAS_PRO_KEY = "zerospike.feedback.wasPro";
/** A loss was seen and the survey has not been shown yet. */
export const SURVEY_PENDING_KEY = "zerospike.feedback.surveyPending";
/** The survey was shown; it is never shown again on this install. */
export const SURVEY_ASKED_KEY = "zerospike.feedback.surveyAsked";

/**
 * The loss is the true to false step of Pro between two looks, the same step
 * lib/services/purchases records as entitlement_lost. A first look (nothing
 * stored) is a baseline, never a loss, so an install that updates the app while
 * already free is not asked.
 */
export function detectProLoss(storedWasPro: boolean | null, isPro: boolean): boolean {
  return storedWasPro === true && !isPro;
}

async function readFlag(kv: KeyValueStore, key: string): Promise<boolean | null> {
  const raw = await kv.get(key);
  return raw === "true" ? true : raw === "false" ? false : null;
}

/**
 * Records the Pro state seen now. On a loss it arms the survey unless it was
 * asked before; regaining Pro disarms a survey that has not been shown yet.
 * Returns true when the survey is armed after this call.
 */
export async function noteProState(kv: KeyValueStore, isPro: boolean): Promise<boolean> {
  try {
    const was = await readFlag(kv, WAS_PRO_KEY);
    const asked = (await readFlag(kv, SURVEY_ASKED_KEY)) === true;
    if (was !== isPro) await kv.set(WAS_PRO_KEY, isPro ? "true" : "false");
    if (isPro) {
      if ((await readFlag(kv, SURVEY_PENDING_KEY)) === true) await kv.set(SURVEY_PENDING_KEY, "false");
      return false;
    }
    if (!asked && detectProLoss(was, isPro)) await kv.set(SURVEY_PENDING_KEY, "true");
    return !asked && (await readFlag(kv, SURVEY_PENDING_KEY)) === true;
  } catch {
    return false;
  }
}

/**
 * Takes the armed survey: true exactly once per install. The asked flag is
 * written before the answer is returned, so an interrupted sheet does not come
 * back (same arrangement as the winback and the alarm tour).
 */
export async function takePendingSurvey(kv: KeyValueStore): Promise<boolean> {
  try {
    if ((await readFlag(kv, SURVEY_ASKED_KEY)) === true) return false;
    if ((await readFlag(kv, SURVEY_PENDING_KEY)) !== true) return false;
    await kv.set(SURVEY_ASKED_KEY, "true");
    await kv.set(SURVEY_PENDING_KEY, "false");
    return true;
  } catch {
    return false;
  }
}

/**
 * Where the survey may open: only on the tab screens (or the bare root), never
 * over the paywall, winback, downsell, onboarding, SOS, the calculator or any
 * other modal route. A blocked moment just waits for the next navigation.
 */
export function isSurveyRoute(root: string | undefined): boolean {
  return root === undefined || root === "(tabs)";
}

export interface SurveyGate {
  ready: boolean;
  onboarded: boolean;
  isPro: boolean;
  screenshotMode: boolean;
  /** Top route segment. */
  root: string | undefined;
  /** The winback is deciding or showing; it goes first. */
  winbackHold: boolean;
}

/** True when nothing stands in the way of presenting an armed survey right now. */
export function surveyMayPresent(g: SurveyGate): boolean {
  return (
    g.ready &&
    g.onboarded &&
    !g.isPro &&
    !g.screenshotMode &&
    !g.winbackHold &&
    isSurveyRoute(g.root)
  );
}

// The winback (app/_layout.tsx) fires on the same step and is a paid offer shown
// once: it takes the screen first. The layout holds the survey while it decides
// whether to open the winback; once the winback route closes the survey may
// follow on the tab screens.
let holds = 0;
const releaseListeners = new Set<() => void>();

export function holdSurvey(): () => void {
  holds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
    if (holds === 0) releaseListeners.forEach((cb) => cb());
  };
}

export function surveyHeld(): boolean {
  return holds > 0;
}

export function onSurveyRelease(cb: () => void): () => void {
  releaseListeners.add(cb);
  return () => {
    releaseListeners.delete(cb);
  };
}
