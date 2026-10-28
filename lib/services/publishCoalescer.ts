/**
 * Leading-edge publish with a trailing send, at most once per `windowMs`, always
 * carrying the LATEST payload. Pure (clock and timers are injected) so the
 * background flush is testable under plain Node.
 *
 * `flush()` sends a waiting payload immediately. It exists for iOS: a payload
 * parked behind the timer is lost to the surfaces when the app is suspended,
 * because JS timers do not run in the background - a corrected or deleted
 * reading would then sit on the widget and the watch until the next foreground.
 */
export interface Coalescer {
  push(json: string): void;
  flush(): void;
}

export function createPublishCoalescer(
  publish: (json: string) => void,
  windowMs: number,
  clock: {
    now: () => number;
    setTimer: (fn: () => void, ms: number) => unknown;
    clearTimer: (handle: unknown) => void;
  }
): Coalescer {
  let lastPublishAt = 0;
  let pendingJson: string | null = null;
  let pendingTimer: unknown = null;

  function send(json: string) {
    lastPublishAt = clock.now();
    publish(json);
  }

  return {
    push(json) {
      const elapsed = clock.now() - lastPublishAt;
      if (elapsed >= windowMs) {
        send(json);
        return;
      }
      pendingJson = json;
      if (pendingTimer != null) return;
      pendingTimer = clock.setTimer(() => {
        pendingTimer = null;
        const next = pendingJson;
        pendingJson = null;
        if (next != null) send(next);
      }, windowMs - elapsed);
    },
    flush() {
      if (pendingTimer != null) {
        clock.clearTimer(pendingTimer);
        pendingTimer = null;
      }
      const next = pendingJson;
      pendingJson = null;
      if (next != null) send(next);
    },
  };
}
