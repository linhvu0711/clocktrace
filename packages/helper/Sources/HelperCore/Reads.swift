import Foundation

public struct Reads {
  public var frontmost: () -> FrontApp?
  public var axTrusted: () -> Bool
  public var focusedTitle: (pid_t) -> String?
  public var automationStatus: (String, Bool) -> OSStatus
  /// The answers to the events, in order, joined by a line feed; nil when any
  /// event fails.
  public var sendEvents: (BrowserEvents) -> String?
  public var safariPrivateFormats: () -> [String]
  public var idleSeconds: () -> Double
  /// The pids a Screen hold counts for; nil when the read fails.
  public var screenHoldPids: () -> Set<pid_t>?

  public init(
    frontmost: @escaping () -> FrontApp?,
    axTrusted: @escaping () -> Bool,
    focusedTitle: @escaping (pid_t) -> String?,
    automationStatus: @escaping (String, Bool) -> OSStatus,
    sendEvents: @escaping (BrowserEvents) -> String?,
    safariPrivateFormats: @escaping () -> [String],
    idleSeconds: @escaping () -> Double,
    screenHoldPids: @escaping () -> Set<pid_t>? = { [] }
  ) {
    self.frontmost = frontmost
    self.axTrusted = axTrusted
    self.focusedTitle = focusedTitle
    self.automationStatus = automationStatus
    self.sendEvents = sendEvents
    self.safariPrivateFormats = safariPrivateFormats
    self.idleSeconds = idleSeconds
    self.screenHoldPids = screenHoldPids
  }
}
