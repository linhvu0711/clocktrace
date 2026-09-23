import Foundation
import XCTest

@testable import HelperCore

final class TrackerTests: XCTestCase {
  private let t0 = Date(timeIntervalSince1970: 1_767_225_600)  // 2026-01-01T00:00:00Z
  private let ts0 = "2026-01-01T00:00:00.000Z"

  private var finderSample: Sample {
    Sample(
      app: "Finder", bundleId: "com.apple.finder", title: "Desktop", url: nil,
      idleSeconds: 2, missing: [])
  }

  func testEmitsTheFirstLine() {
    // Given: a fresh tracker and a Finder sample
    var tracker = Tracker()
    // When
    let line = tracker.observe(finderSample, at: t0)
    // Then
    XCTAssertEqual(
      line,
      Line(
        ts: ts0, app: "Finder", bundleId: "com.apple.finder", title: "Desktop",
        url: nil, idleSeconds: 2, missing: []))
  }

  func testEmitsNothingWithin10SecondsWhenNothingChanged() {
    // Given: the tracker after the first line; same sample, new idle, +9s
    var tracker = Tracker()
    _ = tracker.observe(finderSample, at: t0)
    var next = finderSample
    next.idleSeconds = 5
    // When
    let line = tracker.observe(next, at: t0.addingTimeInterval(9))
    // Then
    XCTAssertNil(line)
  }

  func testEmitsAHeartbeatAfter10Seconds() {
    // Given: the tracker after the first line; same sample, new idle, +10s
    var tracker = Tracker()
    _ = tracker.observe(finderSample, at: t0)
    var next = finderSample
    next.idleSeconds = 12
    // When
    let line = tracker.observe(next, at: t0.addingTimeInterval(10))
    // Then
    XCTAssertEqual(
      line,
      Line(
        ts: "2026-01-01T00:00:10.000Z", app: "Finder", bundleId: "com.apple.finder",
        title: "Desktop", url: nil, idleSeconds: 12, missing: []))
  }

  func testEmitsOnAppChange() {
    // Given: the tracker after the first line; frontmost changes to TextEdit
    var tracker = Tracker()
    _ = tracker.observe(finderSample, at: t0)
    let next = Sample(
      app: "TextEdit", bundleId: "com.apple.TextEdit", title: "Untitled", url: nil,
      idleSeconds: 2, missing: [])
    // When
    let line = tracker.observe(next, at: t0.addingTimeInterval(1))
    // Then
    XCTAssertEqual(
      line,
      Line(
        ts: "2026-01-01T00:00:01.000Z", app: "TextEdit",
        bundleId: "com.apple.TextEdit", title: "Untitled", url: nil,
        idleSeconds: 2, missing: []))
  }

  func testEmitsOnTitleChange() {
    // Given: the tracker after the first line; same app, new title
    var tracker = Tracker()
    _ = tracker.observe(finderSample, at: t0)
    var next = finderSample
    next.title = "Documents"
    // When
    let line = tracker.observe(next, at: t0.addingTimeInterval(1))
    // Then
    XCTAssertEqual(line?.title, "Documents")
    XCTAssertEqual(line?.ts, "2026-01-01T00:00:01.000Z")
  }

  func testEmitsOnUrlChange() {
    // Given: a tracker that emitted Safari at one URL; same sample, new URL
    var tracker = Tracker()
    let safari = Sample(
      app: "Safari", bundleId: "com.apple.Safari", grant: "granted",
      title: "Example Domain", url: "https://example.com/", idleSeconds: 0,
      missing: [])
    _ = tracker.observe(safari, at: t0)
    var next = safari
    next.url = "https://example.org/"
    // When
    let line = tracker.observe(next, at: t0.addingTimeInterval(1))
    // Then
    XCTAssertEqual(line?.url, "https://example.org/")
  }

  func testBackwardClockStillEmitsAHeartbeat() {
    // Given: the tracker emitted at t0 and stayed quiet 5s later; then the
    // clock steps back 30s
    var tracker = Tracker()
    _ = tracker.observe(finderSample, at: t0)
    _ = tracker.observe(finderSample, at: t0.addingTimeInterval(5))
    let backward = t0.addingTimeInterval(-30)
    // When
    let line = tracker.observe(finderSample, at: backward)
    // Then
    XCTAssertEqual(line?.ts, "2025-12-31T23:59:30.000Z")
    // And nothing emits 5s after the backward step while nothing changed
    XCTAssertNil(tracker.observe(finderSample, at: backward.addingTimeInterval(5)))
  }

  func testPassesIdleSecondsThrough() {
    // Given: a fresh tracker; sample with idleSeconds 42.5
    var tracker = Tracker()
    var sample = finderSample
    sample.idleSeconds = 42.5
    // When
    let line = tracker.observe(sample, at: t0)
    // Then
    XCTAssertEqual(line?.idleSeconds, 42.5)
  }

  func testEmitsOnGrantChange() {
    // Given: Safari denied observed at t0
    var tracker = Tracker()
    _ = tracker.observe(
      Sample(
        app: "Safari", bundleId: "com.apple.Safari", grant: "denied", title: "Inbox",
        url: nil, idleSeconds: 0, missing: ["automation:com.apple.Safari"]),
      at: t0)
    // When: the same sample a second later with a new Grant state
    let line = tracker.observe(
      Sample(
        app: "Safari", bundleId: "com.apple.Safari", grant: "noAnswer", title: "Inbox",
        url: nil, idleSeconds: 0, missing: ["automation:com.apple.Safari"]),
      at: t0.addingTimeInterval(1))
    // Then
    XCTAssertEqual(line?.grant, "noAnswer")
    XCTAssertEqual(line?.ts, "2026-01-01T00:00:01.000Z")
  }
}
