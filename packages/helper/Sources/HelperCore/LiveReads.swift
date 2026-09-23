import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

extension Reads {
  public static let live = Reads(
    frontmost: {
      guard let app = NSWorkspace.shared.frontmostApplication else {
        return nil
      }
      return FrontApp(
        name: app.localizedName,
        bundleId: app.bundleIdentifier,
        pid: app.processIdentifier
      )
    },
    axTrusted: {
      AXIsProcessTrusted()
    },
    focusedTitle: { pid in
      let app = AXUIElementCreateApplication(pid)
      var windowRef: AnyObject?
      guard
        AXUIElementCopyAttributeValue(
          app, kAXFocusedWindowAttribute as CFString, &windowRef) == .success,
        let windowRef
      else { return nil }
      var titleRef: AnyObject?
      guard
        AXUIElementCopyAttributeValue(
          windowRef as! AXUIElement, kAXTitleAttribute as CFString, &titleRef)
          == .success
      else { return nil }
      return titleRef as? String
    },
    automationStatus: { bundleId, ask in
      HelperCore.automationStatus(bundleId: bundleId, askUser: ask)
    },
    runScript: { source in
      var error: NSDictionary?
      let result = NSAppleScript(
        source: "with timeout of 2 seconds\n\(source)\nend timeout")?
        .executeAndReturnError(&error)
      return result?.stringValue
    },
    safariPrivateFormats: { [] },
    idleSeconds: {
      CGEventSource.secondsSinceLastEventType(
        .combinedSessionState, eventType: CGEventType(rawValue: ~0)!)
    }
  )
}

func automationStatus(bundleId: String, askUser: Bool) -> OSStatus {
  var addr = AEAddressDesc()
  let createStatus = bundleId.utf8CString.withUnsafeBufferPointer { buffer in
    AECreateDesc(
      DescType(typeApplicationBundleID), buffer.baseAddress,
      bundleId.utf8.count, &addr)
  }
  guard createStatus == noErr else { return OSStatus(createStatus) }
  defer { AEDisposeDesc(&addr) }
  return AEDeterminePermissionToAutomateTarget(
    &addr, AEEventClass(typeWildCard), AEEventID(typeWildCard), askUser)
}
