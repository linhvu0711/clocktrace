import XCTest

@testable import HelperCore

final class SamplerTests: XCTestCase {
  private let safari = FrontApp(
    name: "Safari", bundleId: "com.apple.Safari", pid: 3)
  private let textEdit = FrontApp(
    name: "TextEdit", bundleId: "com.apple.TextEdit", pid: 2)

  func testRunsTheScriptWhenAutomationIsGranted() {
    // Given: Reads for a Safari frontmost with Automation granted
    var scripts: [String] = []
    let reads = Reads(
      frontmost: { self.safari },
      axTrusted: { true },
      focusedTitle: { _ in "Example Domain" },
      automationStatus: { _, _ in 0 },
      runScript: { script in
        scripts.append(script)
        return "https://example.com/"
      },
      idleSeconds: { 1 }
    )
    // When
    let sample = Sampler.sample(reads, urls: UrlReader(reads: reads), at: Date())
    // Then
    XCTAssertEqual(
      sample,
      Sample(
        front: safari, axTrusted: true, title: "Example Domain",
        url: .granted("https://example.com/"), idleSeconds: 1))
    XCTAssertEqual(
      scripts,
      ["tell application \"Safari\" to get URL of current tab of front window"])
  }

  func testDoesNotRunTheScriptWhenAutomationIsNotGranted() {
    // Given: the same Reads with Automation denied
    var scripts: [String] = []
    let reads = Reads(
      frontmost: { self.safari },
      axTrusted: { true },
      focusedTitle: { _ in "Example Domain" },
      automationStatus: { _, _ in -1743 },
      runScript: { script in
        scripts.append(script)
        return "https://example.com/"
      },
      idleSeconds: { 1 }
    )
    // When
    let sample = Sampler.sample(reads, urls: UrlReader(reads: reads), at: Date())
    // Then
    XCTAssertEqual(sample.url, .missing)
    XCTAssertEqual(scripts, [])
  }

  func testAsksNothingForANonBrowser() {
    // Given: Reads for a non-browser frontmost; everything records calls
    var automationCalls: [String] = []
    var scripts: [String] = []
    let reads = Reads(
      frontmost: { self.textEdit },
      axTrusted: { true },
      focusedTitle: { _ in "Untitled" },
      automationStatus: { id, _ in
        automationCalls.append(id)
        return 0
      },
      runScript: { script in
        scripts.append(script)
        return nil
      },
      idleSeconds: { 1 }
    )
    // When
    let sample = Sampler.sample(reads, urls: UrlReader(reads: reads), at: Date())
    // Then
    XCTAssertEqual(sample.url, .notBrowser)
    XCTAssertEqual(automationCalls, [])
    XCTAssertEqual(scripts, [])
  }

  func testAStuckCheckKeepsTheTitle() {
    // Given: Chrome front with a Grant check that sleeps past the limit
    let chrome = FrontApp(
      name: "Google Chrome", bundleId: "com.google.Chrome", pid: 3)
    let reads = Reads(
      frontmost: { chrome },
      axTrusted: { true },
      focusedTitle: { _ in "Inbox" },
      automationStatus: { _, _ in
        Thread.sleep(forTimeInterval: 0.5)
        return 0
      },
      runScript: { _ in nil },
      idleSeconds: { 1 }
    )
    let urls = UrlReader(reads: reads, checkLimit: .milliseconds(50))
    let t0 = Date(timeIntervalSince1970: 1_767_225_600)
    // When
    let sample = Sampler.sample(reads, urls: urls, at: t0)
    // Then
    XCTAssertEqual(
      sample,
      Sample(
        front: chrome, axTrusted: true, title: "Inbox", url: .missing,
        idleSeconds: 1))
  }

  func testTitleNilWhenNotTrusted() {
    // Given: the TextEdit Reads with Accessibility not granted
    var titleCalls: [pid_t] = []
    let reads = Reads(
      frontmost: { self.textEdit },
      axTrusted: { false },
      focusedTitle: { pid in
        titleCalls.append(pid)
        return "Untitled"
      },
      automationStatus: { _, _ in 0 },
      runScript: { _ in nil },
      idleSeconds: { 1 }
    )
    // When
    let sample = Sampler.sample(reads, urls: UrlReader(reads: reads), at: Date())
    // Then
    XCTAssertNil(sample.title)
    XCTAssertFalse(sample.axTrusted)
    XCTAssertEqual(titleCalls, [])
  }
}
