import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import IOKit.pwr_mgt

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
    sendEvents: { events in
      HelperCore.sendEvents(events)
    },
    safariPrivateFormats: { liveSafariPrivateFormats },
    idleSeconds: {
      CGEventSource.secondsSinceLastEventType(
        .combinedSessionState, eventType: CGEventType(rawValue: ~0)!)
    },
    screenHoldPids: {
      var byProcess: Unmanaged<CFDictionary>?
      guard IOPMCopyAssertionsByProcess(&byProcess) == kIOReturnSuccess,
        let holds = byProcess?.takeRetainedValue() as? [NSNumber: [[String: Any]]]
      else { return nil }
      return HelperCore.screenHoldPids(
        Dictionary(
          holds.map { (pid_t($0.key.int32Value), $0.value) },
          uniquingKeysWith: { first, second in first + second }))
    }
  )
}

// Loaded once, on first use; a Safari update takes effect on the next start.
private let liveSafariPrivateFormats = safariPrivateFormats(resources: safariResourcesPath)

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

/// Sends one `get` Apple Event per property chain with `AESendMessage`, which
/// Apple documents as thread-safe when the event names its own reply port.
/// `NSAppleScript` is main-thread only and hung off it (ADR 0015).
func sendEvents(_ events: BrowserEvents) -> String? {
  let target = NSAppleEventDescriptor(bundleIdentifier: events.bundleId)
  var answers: [String] = []
  for properties in events.properties {
    guard let answer = getFromFrontWindow(properties, target: target) else {
      return nil
    }
    answers.append(answer)
  }
  return answers.joined(separator: "\n")
}

private func getFromFrontWindow(
  _ properties: [String], target: NSAppleEventDescriptor
) -> String? {
  guard let specifier = frontWindowSpecifier(properties) else { return nil }
  let event = NSAppleEventDescriptor(
    eventClass: AEEventClass(kAECoreSuite), eventID: AEEventID(kAEGetData),
    targetDescriptor: target, returnID: AEReturnID(kAutoGenerateReturnID),
    transactionID: AETransactionID(kAnyTransactionID))
  event.setParam(specifier, forKeyword: AEKeyword(keyDirectObject))

  // The reply comes back on a port of this call, not on the main run loop.
  var port = mach_port_t()
  guard mach_port_allocate(mach_task_self_, MACH_PORT_RIGHT_RECEIVE, &port) == KERN_SUCCESS
  else { return nil }
  defer { mach_port_mod_refs(mach_task_self_, port, MACH_PORT_RIGHT_RECEIVE, -1) }
  guard
    let replyPort = NSAppleEventDescriptor(
      descriptorType: DescType(typeReplyPortAttr), bytes: &port,
      length: MemoryLayout<mach_port_t>.size)
  else { return nil }
  event.setAttribute(replyPort, forKeyword: AEKeyword(keyReplyPortAttr))

  guard let message = event.aeDesc else { return nil }
  var replyDesc = AppleEvent()
  // 120 ticks is 2 s, the limit the old `with timeout of 2 seconds` had.
  let status = AESendMessage(message, &replyDesc, AESendMode(kAEWaitReply), 120)
  // Owns replyDesc from here and disposes it.
  let reply = NSAppleEventDescriptor(aeDescNoCopy: &replyDesc)
  guard status == noErr else { return nil }
  if let error = reply.paramDescriptor(forKeyword: AEKeyword(keyErrorNumber)),
    error.int32Value != 0
  {
    return nil
  }
  return reply.paramDescriptor(forKeyword: AEKeyword(keyDirectObject))?.stringValue
}

/// `window 1`, then each property of the one before, as `["acTa", "URL "]`.
private func frontWindowSpecifier(_ properties: [String]) -> NSAppleEventDescriptor? {
  var specifier = objectSpecifier(
    wanting: fourCharCode("cwin"), form: DescType(formAbsolutePosition),
    data: NSAppleEventDescriptor(int32: 1), in: NSAppleEventDescriptor.null())
  for code in properties {
    guard let container = specifier else { return nil }
    specifier = objectSpecifier(
      wanting: DescType(cProperty), form: DescType(formPropertyID),
      data: NSAppleEventDescriptor(typeCode: fourCharCode(code)), in: container)
  }
  return specifier
}

private func objectSpecifier(
  wanting desiredClass: DescType, form: DescType, data: NSAppleEventDescriptor,
  in container: NSAppleEventDescriptor
) -> NSAppleEventDescriptor? {
  let record = NSAppleEventDescriptor.record()
  record.setDescriptor(
    NSAppleEventDescriptor(typeCode: desiredClass), forKeyword: AEKeyword(keyAEDesiredClass))
  record.setDescriptor(NSAppleEventDescriptor(enumCode: form), forKeyword: AEKeyword(keyAEKeyForm))
  record.setDescriptor(data, forKeyword: AEKeyword(keyAEKeyData))
  record.setDescriptor(container, forKeyword: AEKeyword(keyAEContainer))
  return record.coerce(toDescriptorType: DescType(typeObjectSpecifier))
}

private func fourCharCode(_ code: String) -> FourCharCode {
  code.utf8.reduce(0) { $0 << 8 | FourCharCode($1) }
}
