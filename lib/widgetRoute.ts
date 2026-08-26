/**
 * Resolves a `zerospike://` widget deep link to the in-app route it targets.
 * Pure: no RN or expo-router import, so a plain Node test can exercise it and
 * so it can be reused from app/_layout.tsx without pulling either in twice.
 *
 * The URL set here must stay byte-identical to the two native/JS surfaces
 * that actually construct these links - targets/widget/DeepLinks.swift (iOS
 * widgets, the superset) and lib/services/androidWidget.ts (the four Android
 * ones) - which scripts/widgetRoute.test.ts checks by reading both files.
 */

export type WidgetRoute =
  | { kind: "sheet"; sheet: string }
  | { kind: "path"; pathname: string; params?: Record<string, string> }
  | null;

/** The only sheet values app/(tabs)/index.tsx knows how to open. An unlisted
 *  value resolves to null rather than being passed through - a made-up sheet
 *  name must never reach the app just because a URL claimed it. */
const KNOWN_SHEETS = new Set([
  "glucose",
  "med",
  "post_meal_2h",
  "post_meal_start",
]);

const SCHEME_PREFIX = "zerospike://";

/** Bir zerospike:// URL'ini uygulama rotasina cevirir. Taninmayan her sey null. */
export function widgetRouteForUrl(url: string): WidgetRoute {
  try {
    if (typeof url !== "string" || !url) return null;
    if (!url.startsWith(SCHEME_PREFIX)) return null;
    const afterScheme = url.slice(SCHEME_PREFIX.length);
    // A real widget link is always triple-slash (scheme + empty host + root
    // path): "zerospike:///...". Anything with no path at all after the
    // scheme's own "//" (eg. bare "zerospike://") has nothing to route to.
    if (!afterScheme.startsWith("/")) return null;
    const afterRoot = afterScheme.slice(1);

    const qIndex = afterRoot.indexOf("?");
    const rawPath = qIndex === -1 ? afterRoot : afterRoot.slice(0, qIndex);
    const rawQuery = qIndex === -1 ? "" : afterRoot.slice(qIndex + 1);
    // Case-sensitive throughout (no toLowerCase); trailing slashes are the only
    // thing tolerated ("...food/" resolves the same as "...food").
    const path = rawPath.replace(/\/+$/, "");
    const params = parseQuery(rawQuery);

    if (path === "") {
      if (Object.prototype.hasOwnProperty.call(params, "sheet")) {
        const sheet = params.sheet;
        return KNOWN_SHEETS.has(sheet) ? { kind: "sheet", sheet } : null;
      }
      return { kind: "path", pathname: "/(tabs)" };
    }

    if (path === "food") {
      return { kind: "path", pathname: "/(tabs)/food" };
    }

    if (path === "injection") {
      const injectionParams: Record<string, string> = {};
      if (Object.prototype.hasOwnProperty.call(params, "segment")) {
        injectionParams.segment = params.segment;
      }
      if (Object.prototype.hasOwnProperty.call(params, "compose")) {
        injectionParams.compose = params.compose;
      }
      return {
        kind: "path",
        pathname: "/(tabs)/injection",
        params: Object.keys(injectionParams).length ? injectionParams : undefined,
      };
    }

    if (path === "settings/reminders") {
      return { kind: "path", pathname: "/settings/reminders" };
    }

    return null;
  } catch {
    // A malformed querystring (eg. a stray "%") must resolve to "nothing to
    // route to", never throw into the caller.
    return null;
  }
}

function parseQuery(raw: string): Record<string, string> {
  const params: Record<string, string> = {};
  if (!raw) return params;
  for (const pair of raw.split("&")) {
    if (!pair) continue;
    const eqIndex = pair.indexOf("=");
    const rawKey = eqIndex === -1 ? pair : pair.slice(0, eqIndex);
    const rawValue = eqIndex === -1 ? "" : pair.slice(eqIndex + 1);
    const key = decodeURIComponent(rawKey);
    if (!key) continue;
    params[key] = decodeURIComponent(rawValue);
  }
  return params;
}
