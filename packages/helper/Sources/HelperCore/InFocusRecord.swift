import Foundation

public enum Focus: String, Equatable {
  case start
  case end
}

public struct InFocusRecord: Equatable {
  public var reason: String?
  public var focus: Focus
  public var timestamp: Double
  public var bundleId: String
  public var appVersion: String?
  public var build: String?

  public init(
    reason: String?,
    focus: Focus,
    timestamp: Double,
    bundleId: String,
    appVersion: String?,
    build: String?
  ) {
    self.reason = reason
    self.focus = focus
    self.timestamp = timestamp
    self.bundleId = bundleId
    self.appVersion = appVersion
    self.build = build
  }
}

public func inFocusRecord(_ payload: Data) -> InFocusRecord? {
  guard let fields = protobufFields(payload) else { return nil }
  var reason: String? = nil
  var focus: Focus? = nil
  var timestamp: Double? = nil
  var bundleId: String? = nil
  var appVersion: String? = nil
  var build: String? = nil
  for field in fields {
    switch (field.number, field.value) {
    case (1, .len(let data)):
      guard let string = String(data: data, encoding: .utf8) else { return nil }
      reason = string
    case (3, .varint(0)):
      focus = .end
    case (3, .varint(1)):
      focus = .start
    case (3, _):
      return nil
    case (4, .i64(let bits)):
      timestamp = Double(bitPattern: bits)
    case (4, _):
      return nil
    case (6, .len(let data)):
      guard let string = String(data: data, encoding: .utf8) else { return nil }
      bundleId = string
    case (6, _):
      return nil
    case (9, .len(let data)):
      guard let string = String(data: data, encoding: .utf8) else { return nil }
      appVersion = string
    case (10, .len(let data)):
      guard let string = String(data: data, encoding: .utf8) else { return nil }
      build = string
    default:
      continue
    }
  }
  guard let focus, let timestamp, let bundleId else { return nil }
  return InFocusRecord(
    reason: reason,
    focus: focus,
    timestamp: timestamp,
    bundleId: bundleId,
    appVersion: appVersion,
    build: build
  )
}
