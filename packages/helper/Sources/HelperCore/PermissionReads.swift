import Foundation

public struct PermissionReads {
  public var axTrusted: () -> Bool
  public var axPrompt: () -> Void
  public var installed: (String) -> Bool
  public var running: (String) -> Bool
  public var automationStatus: (String, Bool) -> OSStatus
  public var canOpenBiomeSyncDb: () -> Bool
  public var openSettings: (String) -> Void

  public init(
    axTrusted: @escaping () -> Bool,
    axPrompt: @escaping () -> Void,
    installed: @escaping (String) -> Bool,
    running: @escaping (String) -> Bool,
    automationStatus: @escaping (String, Bool) -> OSStatus,
    canOpenBiomeSyncDb: @escaping () -> Bool,
    openSettings: @escaping (String) -> Void
  ) {
    self.axTrusted = axTrusted
    self.axPrompt = axPrompt
    self.installed = installed
    self.running = running
    self.automationStatus = automationStatus
    self.canOpenBiomeSyncDb = canOpenBiomeSyncDb
    self.openSettings = openSettings
  }
}
