import SwiftUI
import WatchKit
import WatchConnectivity
import WidgetKit

// R10 FAZ 3: entry point for the watch companion. Activates
// WatchConnectivity and writes every incoming applicationContext (the phone's
// latest LiveData snapshot, pushed by modules/zerospike-watch-bridge) into the
// shared App Group, then asks the complications to redraw. The screen itself
// (ContentView) and the complications (targets/watch-widget) both read from
// that same store - this delegate is the ONLY writer.

@main
struct ZerospikeWatchApp: App {
  @WKExtensionDelegateAdaptor(ExtensionDelegate.self) private var extensionDelegate

  var body: some Scene {
    WindowGroup {
      ContentView()
    }
  }
}

class ExtensionDelegate: NSObject, WKExtensionDelegate, WCSessionDelegate {
  func applicationDidFinishLaunching() {
    guard WCSession.isSupported() else { return }
    WCSession.default.delegate = self
    WCSession.default.activate()
  }

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {}

  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    guard let json = applicationContext["liveData"] as? String else { return }
    DispatchQueue.main.async {
      LiveDataStore.write(json)
      WidgetCenter.shared.reloadAllTimelines()
    }
  }
}
