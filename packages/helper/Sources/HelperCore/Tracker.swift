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
    let candidate = Line(
      ts: Self.isoFormatter.string(from: now),
      app: s.app,
      bundleId: s.bundleId,
      grant: s.grant,
      title: s.title,
      url: s.url,
      idleSeconds: s.idleSeconds,
      missing: s.missing
    )

    let changed: Bool
    if let last {
      changed =
        last.app != candidate.app
        || last.bundleId != candidate.bundleId
        || last.grant != candidate.grant
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
