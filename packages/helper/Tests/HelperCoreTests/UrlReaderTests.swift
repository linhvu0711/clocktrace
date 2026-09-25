import XCTest

@testable import HelperCore

final class UrlReaderTests: XCTestCase {
  private let t0 = Date(timeIntervalSince1970: 1_767_225_600)

  private func reads(
    automationStatus: @escaping (String, Bool) -> OSStatus = { _, _ in 0 },
    sendEvents: @escaping (BrowserEvents) -> String? = { _ in nil }
  ) -> Reads {
    Reads(
      frontmost: { nil },
      axTrusted: { true },
      focusedTitle: { _ in nil },
      automationStatus: automationStatus,
      sendEvents: sendEvents,
      safariPrivateFormats: { [] },
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
        browserEvents(bundleId: "com.google.Chrome")!,
        title: nil, at: t0)
    }
    // Then
    XCTAssertEqual(result, .missing(.noAnswer))
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
    let events = browserEvents(bundleId: "com.google.Chrome")!
    // When: the first check still sleeps at the second read
    let first = reader.read(events, title: nil, at: t0)
    let second = reader.read(
      events, title: nil,
      at: t0.addingTimeInterval(31))
    // Then
    XCTAssertEqual(first, .missing(.noAnswer))
    XCTAssertEqual(second, .missing(.noAnswer))
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
        sendEvents: { _ in "https://mail.google.com/" }),
      checkLimit: .milliseconds(50))
    let events = browserEvents(bundleId: "com.google.Chrome")!
    // When
    let first = reader.read(events, title: nil, at: t0)
    Thread.sleep(forTimeInterval: 0.3)
    let second = reader.read(
      events, title: nil,
      at: t0.addingTimeInterval(29))
    let third = reader.read(
      events, title: nil,
      at: t0.addingTimeInterval(30))
    // Then
    XCTAssertEqual(first, .missing(.noAnswer))
    XCTAssertEqual(second, .missing(.noAnswer))
    XCTAssertEqual(third, .granted("https://mail.google.com/"))
    XCTAssertEqual(calls, 2)
  }

  func testASlowReadHasNoUrl() {
    // Given: a granted browser whose URL read sleeps past the limit
    let reader = UrlReader(
      reads: reads(sendEvents: { _ in
        Thread.sleep(forTimeInterval: 0.5)
        return "https://example.com/"
      }),
      readLimit: .milliseconds(50))
    // When
    let (result, elapsed) = timed {
      reader.read(
        browserEvents(bundleId: "com.apple.Safari")!,
        title: nil, at: t0)
    }
    // Then
    XCTAssertEqual(result, .granted(nil))
    XCTAssertLessThan(elapsed, 0.3)
  }

  func testTheNextReadingReadsAgain() {
    // Given: the first read sleeps past the limit; later reads pass, counted
    var calls = 0
    let reader = UrlReader(
      reads: reads(sendEvents: { _ in
        calls += 1
        if calls == 1 {
          Thread.sleep(forTimeInterval: 0.2)
        }
        return "https://example.com/"
      }),
      readLimit: .milliseconds(50))
    let events = browserEvents(bundleId: "com.apple.Safari")!
    // When
    let first = reader.read(events, title: nil, at: t0)
    let second = reader.read(
      events, title: nil,
      at: t0.addingTimeInterval(1))
    Thread.sleep(forTimeInterval: 0.3)
    let third = reader.read(
      events, title: nil,
      at: t0.addingTimeInterval(2))
    // Then
    XCTAssertEqual(first, .granted(nil))
    XCTAssertEqual(second, .granted(nil))
    XCTAssertEqual(third, .granted("https://example.com/"))
    XCTAssertEqual(calls, 2)
  }

  func testANeverAskedBrowserIsAskedOnce() {
    // Given: a Grant check that was never asked; the ask waits on a semaphore
    var askCount = 0
    let askLock = NSLock()
    let askWaits = DispatchSemaphore(value: 0)
    let reader = UrlReader(
      reads: reads(automationStatus: { _, askUser in
        if askUser {
          askLock.lock()
          askCount += 1
          askLock.unlock()
          askWaits.wait()
          return -1744
        }
        return -1744
      }))
    let events = browserEvents(bundleId: "com.google.Chrome")!
    // When
    let results = [0, 1, 2].map { offset -> (UrlRead, TimeInterval) in
      timed {
        reader.read(
          events, title: nil,
          at: t0.addingTimeInterval(TimeInterval(offset)))
      }
    }
    askWaits.signal()
    // Then
    for (result, elapsed) in results {
      XCTAssertEqual(result, .missing(.notAsked))
      XCTAssertLessThan(elapsed, 0.3)
    }
    XCTAssertEqual(askCount, 1)
  }

  func testAfterAllowTheNextReadingHasTheUrl() {
    // Given: the check reads -1744 until the ask answers 0, then granted
    let askDone = DispatchSemaphore(value: 0)
    var answered = false
    let answeredLock = NSLock()
    let reader = UrlReader(
      reads: reads(
        automationStatus: { _, askUser in
          if askUser {
            askDone.wait()
            answeredLock.lock()
            answered = true
            answeredLock.unlock()
            return 0
          }
          answeredLock.lock()
          let done = answered
          answeredLock.unlock()
          return done ? 0 : -1744
        },
        sendEvents: { _ in "https://example.com/" }))
    let events = browserEvents(bundleId: "com.google.Chrome")!
    // When
    let first = reader.read(events, title: nil, at: t0)
    askDone.signal()
    Thread.sleep(forTimeInterval: 0.1)
    let second = reader.read(
      events, title: nil,
      at: t0.addingTimeInterval(1))
    // Then
    XCTAssertEqual(first, .missing(.notAsked))
    XCTAssertEqual(second, .granted("https://example.com/"))
  }

  func testAnAnsweredBrowserIsNotAskedAgain() {
    // Given: the check reads -1744 until the ask answers -1743, then denied
    var askCount = 0
    var asked = false
    let stateLock = NSLock()
    let reader = UrlReader(
      reads: reads(automationStatus: { _, askUser in
        if askUser {
          stateLock.lock()
          askCount += 1
          asked = true
          stateLock.unlock()
          return -1743
        }
        stateLock.lock()
        let done = asked
        stateLock.unlock()
        return done ? -1743 : -1744
      }))
    let events = browserEvents(bundleId: "com.google.Chrome")!
    // When
    _ = reader.read(events, title: nil, at: t0)
    Thread.sleep(forTimeInterval: 0.1)
    let second = reader.read(
      events, title: nil,
      at: t0.addingTimeInterval(1))
    let third = reader.read(
      events, title: nil,
      at: t0.addingTimeInterval(2))
    // Then
    XCTAssertEqual(second, .missing(.denied))
    XCTAssertEqual(third, .missing(.denied))
    XCTAssertEqual(askCount, 1)
  }

  func testADeniedBrowserIsNeverAsked() {
    // Given: a Grant check that answers denied
    var askCount = 0
    let reader = UrlReader(
      reads: reads(automationStatus: { _, askUser in
        if askUser { askCount += 1 }
        return -1743
      }))
    // When
    let result = reader.read(
      browserEvents(bundleId: "com.google.Chrome")!,
      title: nil, at: t0)
    // Then
    XCTAssertEqual(result, .missing(.denied))
    XCTAssertEqual(askCount, 0)
  }

  private let brave = browserEvents(bundleId: "com.brave.Browser")!
  private let page = "Example Domain - Brave"

  /// A granted reader whose reads answer `answers` at once, in order, and
  /// after that sleep past the 50 ms limit.
  private func reader(
    answers: [String?] = ["normal\nhttps://example.com/"],
    automationStatus: @escaping (String, Bool) -> OSStatus = { _, _ in 0 },
    checkLimit: DispatchTimeInterval = .seconds(2)
  ) -> UrlReader {
    let lock = NSLock()
    var calls = 0
    return UrlReader(
      reads: reads(
        automationStatus: automationStatus,
        sendEvents: { _ in
          lock.lock()
          calls += 1
          let call = calls
          lock.unlock()
          if call <= answers.count {
            return answers[call - 1]
          }
          Thread.sleep(forTimeInterval: 0.5)
          return "normal\nhttps://example.org/"
        }),
      checkLimit: checkLimit,
      readLimit: .milliseconds(50))
  }

  /// A Grant check that answers 0 on its first call and `later` after.
  private func grantedOnce(then later: @escaping () -> OSStatus) -> (String, Bool) -> OSStatus {
    let lock = NSLock()
    var calls = 0
    return { _, _ in
      lock.lock()
      calls += 1
      let call = calls
      lock.unlock()
      return call == 1 ? 0 : later()
    }
  }

  func testASlowReadOnTheSamePageSendsTheLastUrl() {
    // Given: read 1 of Brave at t0 answered
    let reader = reader()
    _ = reader.read(brave, title: page, at: t0)
    // When: read 2, same title, slow
    let result = reader.read(brave, title: page, at: t0.addingTimeInterval(1))
    // Then
    XCTAssertEqual(result, .granted("normal\nhttps://example.com/"))
  }

  func testABusyReadOnTheSamePageSendsTheLastUrl() {
    // Given: read 1 answered; read 2 timed out and still sleeps
    let reader = reader()
    _ = reader.read(brave, title: page, at: t0)
    _ = reader.read(brave, title: page, at: t0.addingTimeInterval(1))
    // When: read 3, same title, at once (busy)
    let result = reader.read(brave, title: page, at: t0.addingTimeInterval(2))
    // Then
    XCTAssertEqual(result, .granted("normal\nhttps://example.com/"))
  }

  func testASlowReadAfterTheTitleChangedSendsNoUrl() {
    // Given: read 1 answered
    let reader = reader()
    _ = reader.read(brave, title: page, at: t0)
    // When: read 2 on another title, slow
    let result = reader.read(
      brave, title: "Other Page - Brave", at: t0.addingTimeInterval(1))
    // Then
    XCTAssertEqual(result, .granted(nil))
  }

  func testABusyReadAfterTheTitleChangedSendsNoUrl() {
    // Given: read 1 answered; read 2, same title, timed out and still sleeps
    let reader = reader()
    _ = reader.read(brave, title: page, at: t0)
    _ = reader.read(brave, title: page, at: t0.addingTimeInterval(1))
    // When: read 3 on another title, at once (busy)
    let result = reader.read(
      brave, title: "Other Page - Brave", at: t0.addingTimeInterval(2))
    // Then
    XCTAssertEqual(result, .granted(nil))
  }

  func testASlowReadInAnotherAppSendsNoUrl() {
    // Given: read 1 of Brave answered
    let reader = reader()
    _ = reader.read(brave, title: page, at: t0)
    // When: read 2 of Chrome, same title, slow
    let result = reader.read(
      browserEvents(bundleId: "com.google.Chrome")!, title: page,
      at: t0.addingTimeInterval(1))
    // Then
    XCTAssertEqual(result, .granted(nil))
  }

  func testTheLastUrlHasNoTimeLimit() {
    // Given: read 1 of Brave at t0 answered
    let reader = reader()
    _ = reader.read(brave, title: page, at: t0)
    // When: read 2 a day later, same title, slow
    let result = reader.read(brave, title: page, at: t0.addingTimeInterval(86_400))
    // Then
    XCTAssertEqual(result, .granted("normal\nhttps://example.com/"))
  }

  func testANewAnswerReplacesTheLastUrl() {
    // Given: reads 1 and 2 answered, the second with another URL
    let reader = reader(answers: ["normal\nhttps://example.com/", "normal\nhttps://example.org/"])
    _ = reader.read(brave, title: page, at: t0)
    _ = reader.read(brave, title: page, at: t0.addingTimeInterval(1))
    // When: read 3, same title, slow
    let result = reader.read(brave, title: page, at: t0.addingTimeInterval(2))
    // Then
    XCTAssertEqual(result, .granted("normal\nhttps://example.org/"))
  }

  func testASlowReadAfterAnErrorAnswerSendsNoUrl() {
    // Given: read 1 answered with an error (no window)
    let reader = reader(answers: [nil])
    _ = reader.read(brave, title: page, at: t0)
    // When: read 2, same title, slow
    let result = reader.read(brave, title: page, at: t0.addingTimeInterval(1))
    // Then
    XCTAssertEqual(result, .granted(nil))
  }

  func testASlowReadWithNoTitleSendsNoUrl() {
    // Given: read 1 with no title (Accessibility off) answered
    let reader = reader()
    _ = reader.read(brave, title: nil, at: t0)
    // When: read 2, no title, slow
    let result = reader.read(brave, title: nil, at: t0.addingTimeInterval(1))
    // Then
    XCTAssertEqual(result, .granted(nil))
  }

  func testADeniedGrantAfterAnAnswerSendsNoUrl() {
    // Given: the Grant check answers 0, then denied; read 1 answered
    let reader = reader(automationStatus: grantedOnce(then: { -1743 }))
    _ = reader.read(brave, title: page, at: t0)
    // When: read 2, same title
    let result = reader.read(brave, title: page, at: t0.addingTimeInterval(1))
    // Then
    XCTAssertEqual(result, .missing(.denied))
  }

  func testANotAskedGrantAfterAnAnswerSendsNoUrl() {
    // Given: the Grant check answers 0, then not asked (the ask too); read 1
    // answered
    let reader = reader(automationStatus: grantedOnce(then: { -1744 }))
    _ = reader.read(brave, title: page, at: t0)
    // When: read 2, same title
    let result = reader.read(brave, title: page, at: t0.addingTimeInterval(1))
    // Then
    XCTAssertEqual(result, .missing(.notAsked))
  }

  func testAGrantCheckThatStopsAnsweringAfterAnAnswerSendsNoUrl() {
    // Given: the Grant check answers 0, then sleeps past its limit; read 1
    // answered
    let reader = reader(
      automationStatus: grantedOnce(then: {
        Thread.sleep(forTimeInterval: 0.5)
        return 0
      }),
      checkLimit: .milliseconds(50))
    _ = reader.read(brave, title: page, at: t0)
    // When: read 2, same title
    let result = reader.read(brave, title: page, at: t0.addingTimeInterval(1))
    // Then
    XCTAssertEqual(result, .missing(.noAnswer))
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
    let events = browserEvents(bundleId: "com.google.Chrome")!
    // When
    _ = reader.read(events, title: nil, at: t0)
    Thread.sleep(forTimeInterval: 0.3)
    _ = reader.read(
      events, title: nil,
      at: t0.addingTimeInterval(30))
    Thread.sleep(forTimeInterval: 0.3)
    _ = reader.read(
      events, title: nil,
      at: t0.addingTimeInterval(60))
    // Then
    XCTAssertEqual(
      lines,
      ["com.google.Chrome did not answer the Grant check, trying again every 30 s"])
  }
}
