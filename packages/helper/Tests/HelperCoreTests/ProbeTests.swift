import XCTest

@testable import HelperCore

final class ProbeTests: XCTestCase {
  private func timed(_ body: () -> ProbeAnswer<Int>) -> (ProbeAnswer<Int>, TimeInterval) {
    let start = Date()
    let result = body()
    return (result, Date().timeIntervalSince(start))
  }

  func testAFastAnswerComesBack() {
    // Given: a fresh probe
    let probe = Probe()
    // When
    let answer = probe.run("com.google.Chrome", within: .milliseconds(500)) { 7 }
    // Then
    XCTAssertEqual(answer, .value(7))
  }

  func testASlowAnswerTimesOut() {
    // Given: work that sleeps past the limit
    let probe = Probe()
    // When
    let (answer, elapsed) = timed {
      probe.run("com.google.Chrome", within: .milliseconds(50)) {
        Thread.sleep(forTimeInterval: 0.5)
        return 7
      }
    }
    // Then
    XCTAssertEqual(answer, .timedOut)
    XCTAssertLessThan(elapsed, 0.3)
  }

  func testASecondCallWhileOneRunsIsBusy() {
    // Given: a first run on the key still sleeps after its limit; the second
    // work counts its calls
    let probe = Probe()
    let first = probe.run("com.google.Chrome", within: .milliseconds(50)) {
      Thread.sleep(forTimeInterval: 0.5)
      return 7
    }
    XCTAssertEqual(first, .timedOut)
    var calls = 0
    // When
    let answer = probe.run("com.google.Chrome", within: .milliseconds(50)) {
      calls += 1
      return 8
    }
    // Then
    XCTAssertEqual(answer, .busy)
    XCTAssertEqual(calls, 0)
  }

  func testALateAnswerIsDropped() {
    // Given: a first run timed out, and its answer came in after the limit
    let probe = Probe()
    let first = probe.run("com.google.Chrome", within: .milliseconds(50)) {
      Thread.sleep(forTimeInterval: 0.2)
      return 1
    }
    XCTAssertEqual(first, .timedOut)
    Thread.sleep(forTimeInterval: 0.3)
    // When
    let answer = probe.run("com.google.Chrome", within: .milliseconds(50)) { 2 }
    // Then
    XCTAssertEqual(answer, .value(2))
  }
}
