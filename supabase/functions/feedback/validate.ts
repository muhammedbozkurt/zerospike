// Pure input validation for the feedback function: no I/O, no Deno globals, so the
// tests import it directly. The only path from request body to a stored row.

export const KINDS = ["suggestion", "bug", "other", "cancel_survey"] as const;
export const REASON_CODES = ["expensive", "not_used", "missing_feature", "bug", "other_app", "other"] as const;
export const PLATFORMS = ["ios", "android"] as const;

export type Kind = (typeof KINDS)[number];

export const MAX_MESSAGE_CHARS = 2000;
export const MAX_EMAIL_CHARS = 254;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// No control, bidi, zero-width or surrogate code points: the database refuses a lone
// surrogate and a NUL, and a failed insert would answer 503 instead of 400.
const BAD = "\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069\\ud800-\\udfff";
const EMAIL = new RegExp(`^[^\\s@${BAD}]+@[^\\s@${BAD}]+\\.[^\\s@${BAD}]+$`, "u");
const APP_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/;
const LOCALE = /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8}){0,3}$/;
// C0 controls except tab and newline, DEL and C1 controls.
// deno-lint-ignore no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

// A surrogate half with no partner cannot be stored as UTF-8.
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
// Bidi overrides/isolates and zero-width characters: dropped before the emptiness check so a
// message of only these counts as empty and none can disguise text in an admin view.
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;

export interface CleanFeedback {
  kind: Kind;
  reason_code: string | null;
  message: string | null;
  contact_email: string | null;
  app_version: string | null;
  platform: string | null;
  locale: string | null;
}

export type ParseResult = { ok: true; value: CleanFeedback } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function has<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

/** Normalizes line breaks, drops control characters, trims, cuts to maxChars code points. */
export function cleanText(value: string, maxChars: number): string {
  const text = value
    .replace(LONE_SURROGATE, "")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL, "")
    .replace(INVISIBLE, "")
    .trim();
  const chars = Array.from(text);
  return chars.length > maxChars ? chars.slice(0, maxChars).join("").trim() : text;
}

export function validEmail(value: string): boolean {
  return value.length <= MAX_EMAIL_CHARS && EMAIL.test(value);
}

/** Install id from the x-device-id header, or the body's install_id; header wins. */
export function installIdFrom(header: string | null, body: unknown): string | null {
  const fromHeader = (header ?? "").trim().toLowerCase();
  if (fromHeader) return UUID.test(fromHeader) ? fromHeader : null;
  if (isRecord(body) && typeof body.install_id === "string") {
    const fromBody = body.install_id.trim().toLowerCase();
    return UUID.test(fromBody) ? fromBody : null;
  }
  return null;
}

export function parseFeedback(body: unknown): ParseResult {
  if (!isRecord(body)) return { ok: false, error: "bad_request" };
  if (!has(KINDS, body.kind)) return { ok: false, error: "bad_kind" };
  const kind = body.kind;

  let reason: string | null = null;
  if (body.reason_code !== undefined && body.reason_code !== null && body.reason_code !== "") {
    if (!has(REASON_CODES, body.reason_code)) return { ok: false, error: "bad_reason_code" };
    if (kind !== "cancel_survey") return { ok: false, error: "bad_reason_code" };
    reason = body.reason_code;
  }

  let message: string | null = null;
  if (body.message !== undefined && body.message !== null) {
    if (typeof body.message !== "string") return { ok: false, error: "bad_message" };
    message = cleanText(body.message, MAX_MESSAGE_CHARS) || null;
  }
  // A suggestion, bug report or note without text carries nothing; a survey may be a code only.
  if (kind === "cancel_survey" ? message === null && reason === null : message === null) {
    return { ok: false, error: "empty_feedback" };
  }

  let email: string | null = null;
  if (body.contact_email !== undefined && body.contact_email !== null) {
    if (typeof body.contact_email !== "string") return { ok: false, error: "bad_contact_email" };
    const trimmed = body.contact_email.trim();
    if (trimmed) {
      if (!validEmail(trimmed)) return { ok: false, error: "bad_contact_email" };
      email = trimmed;
    }
  }

  let platform: string | null = null;
  if (body.platform !== undefined && body.platform !== null && body.platform !== "") {
    if (!has(PLATFORMS, body.platform)) return { ok: false, error: "bad_platform" };
    platform = body.platform;
  }

  const appVersion = typeof body.app_version === "string" ? body.app_version.trim() : "";
  const locale = typeof body.locale === "string" ? body.locale.trim() : "";

  return {
    ok: true,
    value: {
      kind,
      reason_code: reason,
      message,
      contact_email: email,
      app_version: APP_VERSION.test(appVersion) ? appVersion : null,
      platform,
      locale: LOCALE.test(locale) ? locale : null,
    },
  };
}
