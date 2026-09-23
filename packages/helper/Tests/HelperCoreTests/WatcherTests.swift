import XCTest

@testable import HelperCore

final class WatcherTests: XCTestCase {
  private let ghostty = FrontApp(
    name: "Ghostty", bundleId: "com.mitchellh.ghostty", pid: 7)

  private func reads(focusedTitle: @escaping (pid_t) -> String? = { _ in "tab" })
    -> Reads
  {
    Reads(
      frontmost: { self.ghostty },
      axTrusted: { true },
      focusedTitle: focusedTitle,
      automationStatus: { _, _ in 0 },
      runScript: { _ in nil },
      idleSeconds: { 1 }
    )
  }

  func testAPollInsideAPollPrintsNothing() {
    // Given: a Poller whose title read re-enters poll once, like a timer
    // firing inside an activation poll on the main run loop
    final class Box {
      var poller: Poller?
    }
    let box = Box()
    var lines: [String] = []
    var reentered = false
    let poller = Poller(
      reads: reads(focusedTitle: { _ in
        if !reentered {
          reentered = true
          box.poller?.poll()
        }
        return "tab"
      }),
      urls: UrlReader(reads: reads()),
      emit: { lines.append($0) }
    )
    box.poller = poller
    // When
    poller.poll()
    // Then
    XCTAssertEqual(lines.count, 1)
  }

  func testTheLineTimeIsTakenAfterTheSample() {
    // Given: a clock whose first call is t0 and every later call is t0 + 3s
    let t0 = Date(timeIntervalSince1970: 1_767_225_600)
    var calls = 0
    var lines: [String] = []
    let poller = Poller(
      reads: reads(),
      urls: UrlReader(reads: reads()),
      clock: {
        calls += 1
        return calls == 1 ? t0 : t0.addingTimeInterval(3)
      },
      emit: { lines.append($0) }
    )
    // When
    poller.poll()
    // Then
    XCTAssertEqual(lines.count, 1)
    XCTAssertTrue(
      lines[0].contains("\"ts\":\"2026-01-01T00:00:03.000Z\""),
      "line should carry the post-sample time, got \(lines[0])")
  }
}
