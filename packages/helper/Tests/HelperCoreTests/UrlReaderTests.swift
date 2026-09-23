import XCTest

@testable import HelperCore

final class UrlReaderTests: XCTestCase {
  private let t0 = Date(timeIntervalSince1970: 1_767_225_600)

  private func reads(
    automationStatus: @escaping (String, Bool) -> OSStatus = { _, _ in 0 },
    runScript: @escaping (String) -> String? = { _ in nil }
  ) -> Reads {
    Reads(
      frontmost: { nil },
      axTrusted: { true },
      focusedTitle: { _ in nil },
      automationStatus: automationStatus,
      runScript: runScript,
      idleSeconds: { 0 }
    )
  }

  private func timed(_ body: () -> UrlRead) -> (UrlRead, TimeInterval) {
    let start = Date()
    let result = body()
    return (result, Date().timeIntervalSince(start))
  }

  func testACheckThatNeverAnswersIsMissingWithinTheLimit() {
    // Given: a Grant check that sleeps past the limit
    let reader = UrlReader(
      reads: reads(automationStatus: { _, _ in
        Thread.sleep(forTimeInterval: 0.5)
        return 0
      }),
      checkLimit: .milliseconds(50))
    // When
    let (result, elapsed) = timed {
      reader.read(
        bundleId: "com.google.Chrome",
        script: browserScript(bundleId: "com.google.Chrome")!, at: t0)
    }
    // Then
    XCTAssertEqual(result, .missing)
    XCTAssertLessThan(elapsed, 0.3)
  }

  func testNoSecondCheckWhileOneRuns() {
    // Given: a Grant check that sleeps past the limit, counted
    var calls = 0
    let reader = UrlReader(
      reads: reads(automationStatus: { _, _ in
        calls += 1
        Thread.sleep(forTimeInterval: 0.5)
        return 0
      }),
      checkLimit: .milliseconds(50))
    let script = browserScript(bundleId: "com.google.Chrome")!
    // When: the first check still sleeps at the second read
    let first = reader.read(bundleId: "com.google.Chrome", script: script, at: t0)
    let second = reader.read(
      bundleId: "com.google.Chrome", script: script,
      at: t0.addingTimeInterval(31))
    // Then
    XCTAssertEqual(first, .missing)
    XCTAssertEqual(second, .missing)
    XCTAssertEqual(calls, 1)
  }

  func testUrlsComeBackOnceTheCheckAnswers30SecondsLater() {
    // Given: the first check sleeps past the limit; later checks pass
    var calls = 0
    let reader = UrlReader(
      reads: reads(
        automationStatus: { _, _ in
          calls += 1
          if calls == 1 {
            Thread.sleep(forTimeInterval: 0.2)
          }
          return 0
        },
        runScript: { _ in "https://mail.google.com/" }),
      checkLimit: .milliseconds(50))
    let script = browserScript(bundleId: "com.google.Chrome")!
    // When
    let first = reader.read(bundleId: "com.google.Chrome", script: script, at: t0)
    Thread.sleep(forTimeInterval: 0.3)
    let second = reader.read(
      bundleId: "com.google.Chrome", script: script,
      at: t0.addingTimeInterval(29))
    let third = reader.read(
      bundleId: "com.google.Chrome", script: script,
      at: t0.addingTimeInterval(30))
    // Then
    XCTAssertEqual(first, .missing)
    XCTAssertEqual(second, .missing)
    XCTAssertEqual(third, .granted("https://mail.google.com/"))
    XCTAssertEqual(calls, 2)
  }

  func testASlowReadHasNoUrl() {
    // Given: a granted browser whose URL read sleeps past the limit
    let reader = UrlReader(
      reads: reads(runScript: { _ in
        Thread.sleep(forTimeInterval: 0.5)
        return "https://example.com/"
      }),
      readLimit: .milliseconds(50))
    // When
    let (result, elapsed) = timed {
      reader.read(
        bundleId: "com.apple.Safari",
        script: browserScript(bundleId: "com.apple.Safari")!, at: t0)
    }
    // Then
    XCTAssertEqual(result, .granted(nil))
    XCTAssertLessThan(elapsed, 0.3)
  }

  func testTheNextReadingReadsAgain() {
    // Given: the first read sleeps past the limit; later reads pass, counted
    var calls = 0
    let reader = UrlReader(
      reads: reads(runScript: { _ in
        calls += 1
        if calls == 1 {
          Thread.sleep(forTimeInterval: 0.2)
        }
        return "https://example.com/"
      }),
      readLimit: .milliseconds(50))
    let script = browserScript(bundleId: "com.apple.Safari")!
    // When
    let first = reader.read(bundleId: "com.apple.Safari", script: script, at: t0)
    let second = reader.read(
      bundleId: "com.apple.Safari", script: script,
      at: t0.addingTimeInterval(1))
    Thread.sleep(forTimeInterval: 0.3)
    let third = reader.read(
      bundleId: "com.apple.Safari", script: script,
      at: t0.addingTimeInterval(2))
    // Then
    XCTAssertEqual(first, .granted(nil))
    XCTAssertEqual(second, .granted(nil))
    XCTAssertEqual(third, .granted("https://example.com/"))
    XCTAssertEqual(calls, 2)
  }

  func testLogsOnceWhenTheCheckStopsAnswering() {
    // Given: every check sleeps past the limit; the log appends to an array
    var lines: [String] = []
    let reader = UrlReader(
      reads: reads(automationStatus: { _, _ in
        Thread.sleep(forTimeInterval: 0.2)
        return 0
      }),
      checkLimit: .milliseconds(50),
      log: { lines.append($0) })
    let script = browserScript(bundleId: "com.google.Chrome")!
    // When
    _ = reader.read(bundleId: "com.google.Chrome", script: script, at: t0)
    Thread.sleep(forTimeInterval: 0.3)
    _ = reader.read(
      bundleId: "com.google.Chrome", script: script,
      at: t0.addingTimeInterval(30))
    Thread.sleep(forTimeInterval: 0.3)
    _ = reader.read(
      bundleId: "com.google.Chrome", script: script,
      at: t0.addingTimeInterval(60))
    // Then
    XCTAssertEqual(
      lines,
      ["com.google.Chrome did not answer the Grant check, trying again every 30 s"])
  }
}
