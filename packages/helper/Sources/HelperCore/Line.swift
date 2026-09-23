import Foundation

public struct Line: Equatable {
  public var ts: String
  public var app: String?
  public var bundleId: String?
  public var grant: String?
  public var title: String?
  public var url: String?
  public var idleSeconds: Double
  public var missing: [String]

  public init(
    ts: String,
    app: String?,
    bundleId: String?,
    grant: String? = nil,
    title: String?,
    url: String?,
    idleSeconds: Double,
    missing: [String]
  ) {
    self.ts = ts
    self.app = app
    self.bundleId = bundleId
    self.grant = grant
    self.title = title
    self.url = url
    self.idleSeconds = idleSeconds
    self.missing = missing
  }
}

extension Line: Encodable {
  private enum CodingKeys: String, CodingKey {
    case ts
    case app
    case bundleId
    case grant
    case title
    case url
    case idleSeconds
    case missing
  }

  // Synthesized Codable uses encodeIfPresent and would drop nil keys;
  // the wire format requires explicit nulls.
  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(ts, forKey: .ts)
    try container.encode(app, forKey: .app)
    try container.encode(bundleId, forKey: .bundleId)
    try container.encode(grant, forKey: .grant)
    try container.encode(title, forKey: .title)
    try container.encode(url, forKey: .url)
    try container.encode(idleSeconds, forKey: .idleSeconds)
    try container.encode(missing, forKey: .missing)
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
