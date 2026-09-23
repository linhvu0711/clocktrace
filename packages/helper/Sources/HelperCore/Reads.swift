import Foundation

public struct Reads {
  public var frontmost: () -> FrontApp?
  public var axTrusted: () -> Bool
  public var focusedTitle: (pid_t) -> String?
  public var automationStatus: (String, Bool) -> OSStatus
  public var runScript: (String) -> String?
  public var idleSeconds: () -> Double

  public init(
    frontmost: @escaping () -> FrontApp?,
    axTrusted: @escaping () -> Bool,
    focusedTitle: @escaping (pid_t) -> String?,
    automationStatus: @escaping (String, Bool) -> OSStatus,
    runScript: @escaping (String) -> String?,
    idleSeconds: @escaping () -> Double
  ) {
    self.frontmost = frontmost
    self.axTrusted = axTrusted
    self.focusedTitle = focusedTitle
    self.automationStatus = automationStatus
    self.runScript = runScript
    self.idleSeconds = idleSeconds
  }
}
