import WatchConnectivity
import ExpoModulesCore

// Relays the phone's LiveData snapshot to the paired watch's application
// context. Deliberately thin: JS already owns WHEN and WHAT to send
// (lib/services/liveData.ts); this only activates the session and forwards the
// JSON string as-is. The watch cannot read the iPhone App Group, so this is the
// only path LiveData reaches it by (see targets/watch's session delegate).
//
// Every entry point degrades quietly: no paired watch, no companion app
// installed, or a session that fails to activate must never affect logging on
// the phone.

public class ZerospikeWatchBridgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ZerospikeWatchBridge")

    OnCreate {
      if WCSession.isSupported() {
        WCSession.default.delegate = WatchBridgeSessionDelegate.shared
        WCSession.default.activate()
      }
    }

    /// Whether a paired watch has the companion app installed right now.
    Function("isAvailable") { () -> Bool in
      guard WCSession.isSupported() else { return false }
      let session = WCSession.default
      return session.isPaired && session.isWatchAppInstalled
    }

    /// Pushes the latest LiveData JSON. `updateApplicationContext` keeps only
    /// the MOST RECENT payload (older, undelivered ones are replaced), which
    /// matches "the watch always shows the last snapshot", not a message log.
    ///
    /// The pairing guard is not just an optimization: on a simulator (or any
    /// iPhone with no watch), updateApplicationContext throws
    /// WCErrorCodeDeviceNotPaired and WatchConnectivity logs the failure itself,
    /// once per sync, for a push that could never have landed. Skipping it
    /// silently changes nothing else - JS already re-pushes on every snapshot
    /// change, so a watch paired later is served by the very next sync with no
    /// queue of its own.
    Function("pushLiveData") { (json: String) -> Bool in
      guard WCSession.isSupported() else { return false }
      let session = WCSession.default
      guard session.activationState == .activated else { return false }
      guard session.isPaired, session.isWatchAppInstalled else { return false }
      do {
        try session.updateApplicationContext(["liveData": json])
        return true
      } catch {
        return false
      }
    }
  }
}

private class WatchBridgeSessionDelegate: NSObject, WCSessionDelegate {
  static let shared = WatchBridgeSessionDelegate()

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {}

  func sessionDidBecomeInactive(_ session: WCSession) {}

  func sessionDidDeactivate(_ session: WCSession) {
    // Re-activate for the next paired watch (e.g. after an Apple Watch swap).
    session.activate()
  }
}
