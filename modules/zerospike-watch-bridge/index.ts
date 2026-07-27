import { requireOptionalNativeModule } from "expo-modules-core";

/**
 * JS side of the phone -> watch bridge (R10 FAZ 3).
 *
 * The watch cannot read the iPhone's App Group (a WatchKit extension gets its
 * own isolated container), so LiveData reaches it exclusively through
 * WatchConnectivity's `updateApplicationContext` — the "latest snapshot wins,
 * delivered when convenient" channel, which is exactly what a glanceable
 * last-reading/next-reminder summary wants (no need for immediate delivery).
 *
 * `requireOptionalNativeModule` returns null in Expo Go and in any build made
 * before `npx expo prebuild` linked the module, so every call below is a no-op
 * there — a missing watch companion must never affect logging on the phone.
 */
interface WatchBridgeNativeModule {
  isAvailable(): boolean;
  pushLiveData(json: string): boolean;
}

const native = requireOptionalNativeModule<WatchBridgeNativeModule>(
  "ZerospikeWatchBridge"
);

/** True only when a paired watch has the companion app installed. */
export function isWatchBridgeAvailable(): boolean {
  try {
    return native?.isAvailable() ?? false;
  } catch {
    return false;
  }
}

/** Pushes the current LiveData JSON (see lib/services/liveData.ts) to the
 *  watch's application context. Best-effort: WatchConnectivity delivers it
 *  whenever the watch is reachable, not necessarily instantly. */
export function pushLiveDataToWatch(json: string): boolean {
  try {
    return native?.pushLiveData(json) ?? false;
  } catch {
    return false;
  }
}
