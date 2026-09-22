import Foundation

public enum GrantState: String, Encodable, Equatable {
  case granted
  case denied
  case notAsked
  case notRunning
  case noAnswer
  case notInstalled
}

public struct Permissions: Equatable, Encodable {
  public var accessibility: GrantState
  public var automation: [String: GrantState]
  public var fullDiskAccess: GrantState

  public init(
    accessibility: GrantState,
    automation: [String: GrantState],
    fullDiskAccess: GrantState
  ) {
    self.accessibility = accessibility
    self.automation = automation
    self.fullDiskAccess = fullDiskAccess
  }

  public func json() -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    guard let data = try? encoder.encode(self),
      let string = String(data: data, encoding: .utf8)
    else {
      return "{}"
    }
    return string
  }
}
