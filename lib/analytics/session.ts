/**
 * Analytics session bookkeeping, kept free of React Native so it runs under
 * plain node in scripts/analyticsSchema.test.ts. A session starts at cold start
 * and is renewed when the app comes back after 30 minutes in the background.
 */

export const SESSION_IDLE_MS = 30 * 60 * 1000;

/**
 * A return from the background counts as a visit only after this long away.
 * Android reports "background" for a system dialog (permissions, the share
 * sheet), and those blips must not each become an app_open.
 */
export const WARM_OPEN_MIN_BACKGROUND_MS = 10_000;

export interface ForegroundResult {
  /** The idle limit passed, so session id() is a fresh one. */
  rotated: boolean;
  /** Long enough away to report as an app_open with cold:false. */
  warmOpen: boolean;
}

export interface SessionTracker {
  id(): string;
  onBackground(now: number): void;
  onForeground(now: number): ForegroundResult;
}

export function createSessionTracker(newId: () => string): SessionTracker {
  let current = newId();
  let backgroundedAt: number | null = null;
  return {
    id: () => current,
    onBackground(now) {
      if (backgroundedAt === null) backgroundedAt = now;
    },
    onForeground(now) {
      // inactive -> active on iOS (control centre, a call banner) never went to
      // the background, so there is nothing to renew or report.
      if (backgroundedAt === null) return { rotated: false, warmOpen: false };
      const away = now - backgroundedAt;
      backgroundedAt = null;
      const rotated = away >= SESSION_IDLE_MS;
      if (rotated) current = newId();
      return { rotated, warmOpen: away >= WARM_OPEN_MIN_BACKGROUND_MS };
    },
  };
}
