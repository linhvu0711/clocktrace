import Foundation

public struct Tracker {
  private var last: Line?
  private var lastAt: Date?

  private static let heartbeatInterval: TimeInterval = 10
  private static let isoFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()

  public init() {}

  public mutating func observe(_ s: Sample, at now: Date) -> Line? {
    let noUsableFront = s.front == nil || s.front?.bundleId == "com.apple.loginwindow"

    let app = noUsableFront ? nil : s.front?.name
    let bundleId = noUsableFront ? nil : s.front?.bundleId
    let title = noUsableFront ? nil : (s.axTrusted ? s.title : nil)
    let url: String?
    switch s.url {
    case .granted(let u):
      url = noUsableFront ? nil : u
    case .notBrowser, .missing:
      url = nil
    }

    var missing: [String] = []
    if !s.axTrusted {
      missing.append("accessibility")
    }
    if s.url == .missing, let id = s.front?.bundleId, !noUsableFront {
      missing.append("automation:\(id)")
    }

    let candidate = Line(
      ts: Self.isoFormatter.string(from: now),
      app: app,
      bundleId: bundleId,
      title: title,
      url: url,
      idleSeconds: s.idleSeconds,
      missing: missing
    )

    let changed: Bool
    if let last {
      changed =
        last.app != candidate.app
        || last.bundleId != candidate.bundleId
        || last.title != candidate.title
        || last.url != candidate.url
        || last.missing != candidate.missing
    } else {
      changed = true
    }

    let heartbeatDue: Bool
    if let lastAt {
      let elapsed = now.timeIntervalSince(lastAt)
      heartbeatDue = elapsed < 0 || elapsed >= Self.heartbeatInterval
    } else {
      heartbeatDue = true
    }

    guard changed || heartbeatDue else { return nil }
    last = candidate
    lastAt = now
    return candidate
  }
}
