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

// Ported from supabase/functions/feedback/validate.ts (scripts/feedbackSurvey.test.ts
// compares the character set against that file): the server drops these, so the
// client counts them the same way, or it would send a message the server calls empty.
export const BAD_CHARS =
  "\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069\\ud800-\\udfff";
const EMAIL = new RegExp(`^[^\\s@${BAD_CHARS}]+@[^\\s@${BAD_CHARS}]+\\.[^\\s@${BAD_CHARS}]+$`, "u");
// C0 controls except tab and newline, DEL and C1 controls.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;

export function isValidEmail(value: string): boolean {
  return value.length <= MAX_EMAIL_CHARS && EMAIL.test(value);
}

/** What the server keeps of a message: the same steps as its cleanText, so "empty" means the same on both sides. */
export function cleanMessage(value: string): string {
  const text = value
    .replace(LONE_SURROGATE, "")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL, "")
    .replace(INVISIBLE, "")
    .trim();
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
    case "not_configured":
    case "no_device_id":
      return "feedback.errorGeneric";
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

/** True when a survey is armed and has not been asked yet. Writes nothing. */
export async function peekPendingSurvey(kv: KeyValueStore): Promise<boolean> {
  try {
    if ((await readFlag(kv, SURVEY_ASKED_KEY)) === true) return false;
    return (await readFlag(kv, SURVEY_PENDING_KEY)) === true;
  } catch {
    return false;
  }
}

/**
 * Called when the sheet is really on screen (the Modal's onShow), not when it
 * was asked to open: a sheet that never appeared (another Modal was up) leaves
 * the survey armed for the next try. After this it is never asked again.
 */
export async function markSurveyAsked(kv: KeyValueStore): Promise<void> {
  try {
    await kv.set(SURVEY_ASKED_KEY, "true");
    await kv.set(SURVEY_PENDING_KEY, "false");
  } catch {
    // best-effort; the worst case is one more ask
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
  /** Another sheet or dialog Modal is on screen (see registerOverlay). */
  overlayOpen: boolean;
}

/** True when nothing stands in the way of presenting an armed survey right now. */
export function surveyMayPresent(g: SurveyGate): boolean {
  return (
    g.ready &&
    g.onboarded &&
    !g.isPro &&
    !g.screenshotMode &&
    !g.winbackHold &&
    !g.overlayOpen &&
    isSurveyRoute(g.root)
  );
}

// The winback (app/_layout.tsx) fires on the same step and is a paid offer shown
// once: it takes the screen first. The layout holds the survey while it decides
// whether to open the winback; once the winback route closes the survey may
// follow on the tab screens.
let holds = 0;
let overlays = 0;
const releaseListeners = new Set<() => void>();

function notifyIfIdle(): void {
  if (holds === 0 && overlays === 0) releaseListeners.forEach((cb) => cb());
}

export function holdSurvey(): () => void {
  holds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
    notifyIfIdle();
  };
}

export function surveyHeld(): boolean {
  return holds > 0;
}

/**
 * Sheets and dialogs that are RN Modals register while visible. Two Modals
 * cannot be presented together on iOS, so the survey waits for the count to
 * fall back to zero instead of opening over (or failing under) one.
 */
export function registerOverlay(): () => void {
  overlays += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    overlays = Math.max(0, overlays - 1);
    notifyIfIdle();
  };
}

export function overlayOpen(): boolean {
  return overlays > 0;
}

/** Fires when neither the winback hold nor any overlay is left. */
export function onSurveyRelease(cb: () => void): () => void {
  releaseListeners.add(cb);
  return () => {
    releaseListeners.delete(cb);
  };
}

// ---------------------------------------------------------------------------
// Closing and sending the sheet
// ---------------------------------------------------------------------------

export interface CloseState {
  busy: boolean;
  survey: boolean;
  hasText: boolean;
}

/**
 * The scrim, the back key and the title X close the sheet only when that costs
 * nothing: never while a send is in flight, and in the survey (asked once, so
 * typed text would be lost for good) not while text is typed. The footer's
 * "Close without sending" is a deliberate choice and works except mid-send.
 */
export function mayCloseByGesture(s: CloseState): boolean {
  if (s.busy) return false;
  if (s.survey && s.hasText) return false;
  return true;
}

export function mayCloseByButton(s: Pick<CloseState, "busy">): boolean {
  return !s.busy;
}

/** One send at a time: tryAcquire returns true to the caller that won the slot, who must release it. */
export function createSendSlot(): { tryAcquire(): boolean; release(): void } {
  let inFlight = false;
  return {
    tryAcquire() {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    release() {
      inFlight = false;
    },
  };
}
