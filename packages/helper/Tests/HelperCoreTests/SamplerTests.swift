import XCTest

@testable import HelperCore

final class SamplerTests: XCTestCase {
  private let safari = FrontApp(
    name: "Safari", bundleId: "com.apple.Safari", pid: 3)
  private let textEdit = FrontApp(
    name: "TextEdit", bundleId: "com.apple.TextEdit", pid: 2)
  private let brave = FrontApp(
    name: "Brave Browser", bundleId: "com.brave.Browser", pid: 4)
  private let t0 = Date(timeIntervalSince1970: 1_767_225_600)
  private let ts0 = "2026-01-01T00:00:00.000Z"

  private func reads(
    front: FrontApp,
    axTrusted: Bool,
    title: String?,
    runScript: @escaping (String) -> String?,
    safariPrivateFormats: [String] = []
  ) -> Reads {
    Reads(
      frontmost: { front },
      axTrusted: { axTrusted },
      focusedTitle: { _ in title },
      automationStatus: { _, _ in 0 },
      runScript: runScript,
      safariPrivateFormats: { safariPrivateFormats },
      idleSeconds: { 1 }
    )
  }

  private func line(_ reads: Reads, urls: UrlReader? = nil) -> Line? {
    var tracker = Tracker()
    return tracker.observe(
      Sampler.sample(reads, urls: urls ?? UrlReader(reads: reads), at: t0), at: t0)
  }

  private func braveLine(title: String?, url: String?, missing: [String]) -> Line {
    Line(
      ts: ts0, app: "Brave Browser", bundleId: "com.brave.Browser", grant: "granted",
      title: title, url: url, idleSeconds: 1, missing: missing)
  }

  func testAChromeIncognitoWindowHasNoTitleOrUrl() {
    // Given: Brave front, Accessibility on, an incognito window
    let r = reads(
      front: brave, axTrusted: true, title: "Example Domain - Brave (Private)",
      runScript: { _ in "incognito\nhttps://example.com/" })
    // When
    let result = line(r)
    // Then
    XCTAssertEqual(result, braveLine(title: nil, url: nil, missing: []))
  }

  func testAChromeIncognitoWindowWithoutAccessibilityHasNoTitleOrUrl() {
    // Given: Brave front, Accessibility off, an incognito window
    let r = reads(
      front: brave, axTrusted: false, title: "Example Domain - Brave (Private)",
      runScript: { _ in "incognito\nhttps://example.com/" })
    // When
    let result = line(r)
    // Then
    XCTAssertEqual(result, braveLine(title: nil, url: nil, missing: ["accessibility"]))
  }

  func testAChromeNormalWindowKeepsTheTitleAndUrl() {
    // Given: Brave front, Accessibility on, a normal window
    let r = reads(
      front: brave, axTrusted: true, title: "Example Domain - Brave",
      runScript: { _ in "normal\nhttps://example.com/" })
    // When
    let result = line(r)
    // Then
    XCTAssertEqual(
      result,
      braveLine(title: "Example Domain - Brave", url: "https://example.com/", missing: []))
  }

  func testAChromeNormalWindowWithoutAccessibilityKeepsTheUrl() {
    // Given: Brave front, Accessibility off, a normal window
    let r = reads(
      front: brave, axTrusted: false, title: "Example Domain - Brave",
      runScript: { _ in "normal\nhttps://example.com/" })
    // When
    let result = line(r)
    // Then
    XCTAssertEqual(
      result,
      braveLine(title: nil, url: "https://example.com/", missing: ["accessibility"]))
  }

  func testAFailedChromeScriptHasNoUrl() {
    // Given: Brave front, Accessibility on, the script fails
    let r = reads(
      front: brave, axTrusted: true, title: "Example Domain - Brave",
      runScript: { _ in nil })
    // When
    let result = line(r)
    // Then
    XCTAssertEqual(
      result, braveLine(title: "Example Domain - Brave", url: nil, missing: []))
  }

  func testAChromeOutputWithoutAModeHasNoUrl() {
    // Given: Brave front, Accessibility on, the script gives a URL with no mode
    let r = reads(
      front: brave, axTrusted: true, title: "Example Domain - Brave",
      runScript: { _ in "https://example.com/" })
    // When
    let result = line(r)
    // Then
    XCTAssertEqual(
      result, braveLine(title: "Example Domain - Brave", url: nil, missing: []))
  }

  func testASlowChromeReadHasNoUrl() {
    // Given: Brave front, Accessibility on, the read sleeps past the limit
    let r = reads(
      front: brave, axTrusted: true, title: "Example Domain - Brave",
      runScript: { _ in
        Thread.sleep(forTimeInterval: 0.5)
        return "normal\nhttps://example.com/"
      })
    let urls = UrlReader(reads: r, readLimit: .milliseconds(50))
    // When
    let result = line(r, urls: urls)
    // Then
    XCTAssertEqual(
      result, braveLine(title: "Example Domain - Brave", url: nil, missing: []))
  }

  private let safariFormats = ["%@, Private Browsing", "%@, navigation privée"]

  private func safariReads(
    axTrusted: Bool, title: String?, safariPrivateFormats: [String]? = nil
  ) -> Reads {
    reads(
      front: safari, axTrusted: axTrusted, title: title,
      runScript: { _ in "https://example.com/" },
      safariPrivateFormats: safariPrivateFormats ?? safariFormats)
  }

  private func safariLine(title: String?, url: String?, missing: [String]) -> Line {
    Line(
      ts: ts0, app: "Safari", bundleId: "com.apple.Safari", grant: "granted",
      title: title, url: url, idleSeconds: 1, missing: missing)
  }

  func testASafariPrivateWindowHasNoTitleOrUrl() {
    // Given: Safari front, Accessibility on, an English private window
    let r = safariReads(axTrusted: true, title: "Example Domain, Private Browsing")
    // When
    let result = line(r)
    // Then
    XCTAssertEqual(result, safariLine(title: nil, url: nil, missing: []))
  }

  func testAFrenchSafariPrivateWindowHasNoTitleOrUrl() {
    // Given: Safari front, Accessibility on, a French private window
    let r = safariReads(axTrusted: true, title: "Example Domain, navigation privée")
    // When
    let result = line(r)
    // Then
    XCTAssertEqual(result, safariLine(title: nil, url: nil, missing: []))
  }

  func testASafariNormalWindowKeepsTheTitleAndUrl() {
    // Given: Safari front, Accessibility on, a normal window
    let r = safariReads(axTrusted: true, title: "Example Domain")
    // When
    let result = line(r)
    // Then
    XCTAssertEqual(
      result,
      safariLine(title: "Example Domain", url: "https://example.com/", missing: []))
  }

  func testSafariWithoutAccessibilityHasNoUrl() {
    // Given: Safari front, Accessibility off
    let r = safariReads(axTrusted: false, title: "Example Domain")
    // When
    let result = line(r)
    // Then
    XCTAssertEqual(
      result, safariLine(title: nil, url: nil, missing: ["accessibility"]))
  }

  func testSafariWithNoPrivateFormatsHasNoUrl() {
    // Given: Safari front, Accessibility on, no private text loaded
    let r = safariReads(
      axTrusted: true, title: "Example Domain", safariPrivateFormats: [])
    // When
    let result = line(r)
    // Then
    XCTAssertEqual(
      result, safariLine(title: "Example Domain", url: nil, missing: []))
  }

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
      safariPrivateFormats: { ["%@, Private Browsing"] },
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
      safariPrivateFormats: { [] },
      idleSeconds: { 1 }
    )
    // When
    let sample = Sampler.sample(reads, urls: UrlReader(reads: reads), at: Date())
    // Then
    XCTAssertEqual(sample.url, .missing(.denied))
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
      safariPrivateFormats: { [] },
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
      safariPrivateFormats: { [] },
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
        front: chrome, axTrusted: true, title: "Inbox", url: .missing(.noAnswer),
        idleSeconds: 1))
  }

  func testTheTitleStaysWhileTheAskWaits() {
    // Given: Chrome front, the check never asked, the ask waits on a semaphore
    let chrome = FrontApp(
      name: "Google Chrome", bundleId: "com.google.Chrome", pid: 3)
    let askWaits = DispatchSemaphore(value: 0)
    let reads = Reads(
      frontmost: { chrome },
      axTrusted: { true },
      focusedTitle: { _ in "Inbox" },
      automationStatus: { _, askUser in
        if askUser {
          askWaits.wait()
        }
        return -1744
      },
      runScript: { _ in nil },
      safariPrivateFormats: { [] },
      idleSeconds: { 1 }
    )
    let t0 = Date(timeIntervalSince1970: 1_767_225_600)
    // When
    let sample = Sampler.sample(reads, urls: UrlReader(reads: reads), at: t0)
    askWaits.signal()
    // Then
    XCTAssertEqual(
      sample,
      Sample(
        front: chrome, axTrusted: true, title: "Inbox",
        url: .missing(.notAsked), idleSeconds: 1))
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
      safariPrivateFormats: { [] },
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
