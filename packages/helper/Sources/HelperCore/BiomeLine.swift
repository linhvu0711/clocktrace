import Foundation

public struct BiomeRecordLine: Equatable {
  public var device: String
  public var ts: Double
  public var focus: Focus
  public var bundleId: String
  public var reason: String?
  public var appVersion: String?
  public var build: String?
  public var segment: String
  public var offset: Int

  public init(
    device: String,
    ts: Double,
    focus: Focus,
    bundleId: String,
    reason: String?,
    appVersion: String?,
    build: String?,
    segment: String,
    offset: Int
  ) {
    self.device = device
    self.ts = ts
    self.focus = focus
    self.bundleId = bundleId
    self.reason = reason
    self.appVersion = appVersion
    self.build = build
    self.segment = segment
    self.offset = offset
  }
}

extension BiomeRecordLine: Encodable {
  private enum CodingKeys: String, CodingKey {
    case device
    case ts
    case focus
    case bundleId
    case reason
    case appVersion
    case build
    case segment
    case offset
  }

  // Synthesized Codable uses encodeIfPresent and would drop nil keys;
  // the wire format requires explicit nulls.
  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(device, forKey: .device)
    try container.encode(ts, forKey: .ts)
    try container.encode(focus.rawValue, forKey: .focus)
    try container.encode(bundleId, forKey: .bundleId)
    try container.encode(reason, forKey: .reason)
    try container.encode(appVersion, forKey: .appVersion)
    try container.encode(build, forKey: .build)
    try container.encode(segment, forKey: .segment)
    try container.encode(offset, forKey: .offset)
  }
}

public struct BiomeParseErrorLine: Equatable {
  public var device: String
  public var segment: String
  public var offset: Int

  public init(device: String, segment: String, offset: Int) {
    self.device = device
    self.segment = segment
    self.offset = offset
  }
}

extension BiomeParseErrorLine: Encodable {
  private enum CodingKeys: String, CodingKey {
    case device
    case error
    case segment
    case offset
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(device, forKey: .device)
    try container.encode("parse", forKey: .error)
    try container.encode(segment, forKey: .segment)
    try container.encode(offset, forKey: .offset)
  }
}

public struct DevicePeerLine: Equatable {
  public var deviceIdentifier: String
  public var me: Bool
  public var name: String?
  public var model: String?
  public var platform: Int?
  public var lastSyncDate: Double?

  public init(
    deviceIdentifier: String,
    me: Bool,
    name: String?,
    model: String?,
    platform: Int?,
    lastSyncDate: Double?
  ) {
    self.deviceIdentifier = deviceIdentifier
    self.me = me
    self.name = name
    self.model = model
    self.platform = platform
    self.lastSyncDate = lastSyncDate
  }
}

extension DevicePeerLine: Encodable {
  private enum CodingKeys: String, CodingKey {
    case deviceIdentifier
    case me
    case name
    case model
    case platform
    case lastSyncDate
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(deviceIdentifier, forKey: .deviceIdentifier)
    try container.encode(me, forKey: .me)
    try container.encode(name, forKey: .name)
    try container.encode(model, forKey: .model)
    try container.encode(platform, forKey: .platform)
    try container.encode(lastSyncDate, forKey: .lastSyncDate)
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

public enum BiomeLine: Equatable {
  case record(BiomeRecordLine)
  case parseError(BiomeParseErrorLine)

  public func json() -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    let data: Data?
    switch self {
    case .record(let line):
      data = try? encoder.encode(line)
    case .parseError(let line):
      data = try? encoder.encode(line)
    }
    guard let data, let string = String(data: data, encoding: .utf8) else {
      return "{}"
    }
    return string
  }
}
