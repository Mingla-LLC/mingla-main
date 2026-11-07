// #4271 — Apple requires a "How to Tap" instructional overlay when a merchant
// enables Tap to Pay on iPhone, before App Review. Apple's ProximityReaderDiscovery
// (iOS 18+) supplies localized, up-to-date content; we present it, we don't
// redraw it. Earlier iOS versions get the app's own setup explanation instead
// (isAvailable() returns false).
import ExpoModulesCore
import UIKit
#if canImport(ProximityReader)
import ProximityReader
#endif

public class MinglaTapToPayEducationModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MinglaTapToPayEducation")

    // #4271 release gate, binary half. Set only by the entitled build profile
    // (app.config.js); an over-the-air update cannot change Info.plist.
    Function("isEntitled") { () -> Bool in
      Bundle.main.object(forInfoDictionaryKey: "MinglaTapToPayEntitled") as? Bool == true
    }

    AsyncFunction("isAvailable") { () -> Bool in
      #if canImport(ProximityReader)
      if #available(iOS 18.0, *) {
        return true
      }
      #endif
      return false
    }

    AsyncFunction("showHowToTap") { (promise: Promise) in
      #if canImport(ProximityReader)
      if #available(iOS 18.0, *) {
        Task { @MainActor in
          do {
            guard let presenter = MinglaTapToPayEducationModule.topViewController() else {
              promise.reject("E_NO_PRESENTER", "No visible screen to present How to Tap from.")
              return
            }
            let discovery = ProximityReaderDiscovery()
            let content = try await discovery.content(for: .payment(.howToTap))
            try await discovery.presentContent(content, from: presenter)
            promise.resolve(true)
          } catch {
            promise.reject("E_HOW_TO_TAP", error.localizedDescription)
          }
        }
        return
      }
      #endif
      promise.resolve(false)
    }
  }

  @MainActor
  private static func topViewController() -> UIViewController? {
    let window = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }
    var top = window?.rootViewController
    while let presented = top?.presentedViewController {
      top = presented
    }
    return top
  }
}
