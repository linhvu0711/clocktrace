import Foundation
import XCTest

@testable import HelperCore

final class TrackerTests: XCTestCase {
  private let t0 = Date(timeIntervalSince1970: 1_767_225_600)  // 2026-01-01T00:00:00Z
  private let ts0 = "2026-01-01T00:00:00.000Z"

  private var finderSample: Sample {
    Sample(
      front: FrontApp(name: "Finder", bundleId: "com.apple.finder", pid: 1),
      axTrusted: true,
      title: "Desktop",
      url: .notBrowser,
      idleSeconds: 2
    )
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
      front: FrontApp(name: "TextEdit", bundleId: "com.apple.TextEdit", pid: 2),
      axTrusted: true, title: "Untitled", url: .notBrowser, idleSeconds: 2)
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
      front: FrontApp(name: "Safari", bundleId: "com.apple.Safari", pid: 3),
      axTrusted: true, title: "Example Domain",
      url: .granted("https://example.com/"), idleSeconds: 0)
    _ = tracker.observe(safari, at: t0)
    var next = safari
    next.url = .granted("https://example.org/")
    // When
    let line = tracker.observe(next, at: t0.addingTimeInterval(1))
    // Then
    XCTAssertEqual(line?.url, "https://example.org/")
  }

  func testTitleNullAndMissingAccessibilityWhenNotTrusted() {
    // Given: a fresh tracker; frontmost Finder but Accessibility not granted
    var tracker = Tracker()
    let sample = Sample(
      front: FrontApp(name: "Finder", bundleId: "com.apple.finder", pid: 1),
      axTrusted: false, title: nil, url: .notBrowser, idleSeconds: 0)
    // When
    let line = tracker.observe(sample, at: t0)
    // Then
    XCTAssertEqual(
      line,
      Line(
        ts: ts0, app: "Finder", bundleId: "com.apple.finder", title: nil,
        url: nil, idleSeconds: 0, missing: ["accessibility"]))
  }

  func testTitleFromTheFocusedWindowWhenTrusted() {
    // Given: a fresh tracker; Accessibility granted, title available
    var tracker = Tracker()
    // When
    let line = tracker.observe(finderSample, at: t0)
    // Then
    XCTAssertEqual(line?.title, "Desktop")
    XCTAssertEqual(line?.missing, [])
  }

  func testUrlNullAndMissingAutomationWhenNotGranted() {
    // Given: a fresh tracker; Safari frontmost, Automation denied
    var tracker = Tracker()
    let sample = Sample(
      front: FrontApp(name: "Safari", bundleId: "com.apple.Safari", pid: 3),
      axTrusted: true, title: "Example Domain", url: .missing, idleSeconds: 0)
    // When
    let line = tracker.observe(sample, at: t0)
    // Then
    XCTAssertEqual(
      line,
      Line(
        ts: ts0, app: "Safari", bundleId: "com.apple.Safari",
        title: "Example Domain", url: nil, idleSeconds: 0,
        missing: ["automation:com.apple.Safari"]))
  }

  func testUrlNullAndNothingMissingForANonBrowser() {
    // Given: a fresh tracker; a non-browser app is frontmost
    var tracker = Tracker()
    let sample = Sample(
      front: FrontApp(name: "TextEdit", bundleId: "com.apple.TextEdit", pid: 2),
      axTrusted: true, title: "Untitled", url: .notBrowser, idleSeconds: 0)
    // When
    let line = tracker.observe(sample, at: t0)
    // Then
    XCTAssertNil(line?.url)
    XCTAssertEqual(line?.missing, [])
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

  func testAppNullWhenThereIsNoFrontmostApp() {
    // Given: a fresh tracker; no frontmost app
    var tracker = Tracker()
    let sample = Sample(
      front: nil, axTrusted: true, title: nil, url: .notBrowser, idleSeconds: 0)
    // When
    let line = tracker.observe(sample, at: t0)
    // Then
    XCTAssertEqual(
      line,
      Line(
        ts: ts0, app: nil, bundleId: nil, title: nil, url: nil, idleSeconds: 0,
        missing: []))
  }

  func testAppNullForTheLoginWindow() {
    // Given: a fresh tracker; loginwindow is frontmost
    var tracker = Tracker()
    let sample = Sample(
      front: FrontApp(
        name: "loginwindow", bundleId: "com.apple.loginwindow", pid: 4),
      axTrusted: true, title: "Login", url: .notBrowser, idleSeconds: 0)
    // When
    let line = tracker.observe(sample, at: t0)
    // Then
    XCTAssertEqual(
      line,
      Line(
        ts: ts0, app: nil, bundleId: nil, title: nil, url: nil, idleSeconds: 0,
        missing: []))
  }
}
