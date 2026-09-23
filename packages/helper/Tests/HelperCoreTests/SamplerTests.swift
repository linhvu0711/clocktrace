import XCTest

@testable import HelperCore

final class SamplerTests: XCTestCase {
  private let safari = FrontApp(
    name: "Safari", bundleId: "com.apple.Safari", pid: 3)
  private let textEdit = FrontApp(
    name: "TextEdit", bundleId: "com.apple.TextEdit", pid: 2)
  private let brave = FrontApp(
    name: "Brave Browser", bundleId: "com.brave.Browser", pid: 4)
  private let finder = FrontApp(
    name: "Finder", bundleId: "com.apple.finder", pid: 1)
  private let loginWindow = FrontApp(
    name: "loginwindow", bundleId: "com.apple.loginwindow", pid: 4)
  private let t0 = Date(timeIntervalSince1970: 1_767_225_600)
  private let ts0 = "2026-01-01T00:00:00.000Z"

  private func reads(
    front: FrontApp?,
    axTrusted: Bool,
    title: String?,
    runScript: @escaping (String) -> String?,
    safariPrivateFormats: [String] = [],
    automationStatus: @escaping (String, Bool) -> OSStatus = { _, _ in 0 }
  ) -> Reads {
    Reads(
      frontmost: { front },
      axTrusted: { axTrusted },
      focusedTitle: { _ in title },
      automationStatus: automationStatus,
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

  func testTheLoginWindowLineIsEmpty() {
    // Given: the login window front, Accessibility on
    let r = reads(
      front: loginWindow, axTrusted: true, title: "Login", runScript: { _ in nil })
    // When
    let result = line(r)
    // Then
    XCTAssertEqual(
      result,
      Line(
        ts: ts0, app: nil, bundleId: nil, title: nil, url: nil, idleSeconds: 1,
        missing: []))
  }

  func testTheNoAccessibilityLineHasNoTitle() {
    // Given: TextEdit front, Accessibility off
    let r = reads(
      front: textEdit, axTrusted: false, title: "Untitled", runScript: { _ in nil })
    // When
    let result = line(r)
    // Then
    XCTAssertEqual(
      result,
      Line(
        ts: ts0, app: "TextEdit", bundleId: "com.apple.TextEdit", title: nil,
        url: nil, idleSeconds: 1, missing: ["accessibility"]))
  }

  func testTheDeniedBrowserLineMissesAutomation() {
    // Given: Safari front, Accessibility on, Automation denied
    let r = reads(
      front: safari, axTrusted: true, title: "Example Domain",
      runScript: { _ in "https://example.com/" },
      safariPrivateFormats: safariFormats,
      automationStatus: { _, _ in -1743 })
    // When
    let result = line(r)
    // Then
    XCTAssertEqual(
      result,
      Line(
        ts: ts0, app: "Safari", bundleId: "com.apple.Safari", grant: "denied",
        title: "Example Domain", url: nil, idleSeconds: 1,
        missing: ["automation:com.apple.Safari"]))
  }

  func testTheSlowGrantCheckLineIsNoAnswer() {
    // Given: Chrome front, Accessibility on, the Grant check sleeps past the limit
    let chrome = FrontApp(
      name: "Google Chrome", bundleId: "com.google.Chrome", pid: 3)
    let r = reads(
      front: chrome, axTrusted: true, title: "Inbox", runScript: { _ in nil },
      automationStatus: { _, _ in
        Thread.sleep(forTimeInterval: 0.5)
        return 0
      })
    let urls = UrlReader(reads: r, checkLimit: .milliseconds(50))
    // When
    let result = line(r, urls: urls)
    // Then
    XCTAssertEqual(
      result,
      Line(
        ts: ts0, app: "Google Chrome", bundleId: "com.google.Chrome",
        grant: "noAnswer", title: "Inbox", url: nil, idleSeconds: 1,
        missing: ["automation:com.google.Chrome"]))
  }

  func testTheWineAppLineKeepsItsName() {
    // Given: a Wine app with no bundle id front, Accessibility on, no title
    let wine = FrontApp(name: "QSanguosha.exe", bundleId: nil, pid: 5)
    let r = reads(front: wine, axTrusted: true, title: nil, runScript: { _ in nil })
    // When
    let result = line(r)
    // Then
    XCTAssertEqual(
      result,
      Line(
        ts: ts0, app: "QSanguosha.exe", bundleId: nil, title: nil, url: nil,
        idleSeconds: 1, missing: []))
  }

  private func sample(_ reads: Reads) -> Sample {
    Sampler.sample(reads, urls: UrlReader(reads: reads), at: t0)
  }

  func testTitleNullAndMissingAccessibilityWhenNotTrusted() {
    // Given: Finder front, Accessibility not granted
    let r = reads(front: finder, axTrusted: false, title: "Desktop", runScript: { _ in nil })
    // When
    let result = sample(r)
    // Then
    XCTAssertEqual(
      result,
      Sample(
        app: "Finder", bundleId: "com.apple.finder", title: nil, url: nil,
        idleSeconds: 1, missing: ["accessibility"]))
  }

  func testTitleFromTheFocusedWindowWhenTrusted() {
    // Given: Finder front, Accessibility granted, title available
    let r = reads(front: finder, axTrusted: true, title: "Desktop", runScript: { _ in nil })
    // When
    let result = sample(r)
    // Then
    XCTAssertEqual(result.title, "Desktop")
    XCTAssertEqual(result.missing, [])
  }

  func testUrlNullAndMissingAutomationWhenNotGranted() {
    // Given: Safari front, Automation denied
    let r = reads(
      front: safari, axTrusted: true, title: "Example Domain",
      runScript: { _ in "https://example.com/" },
      automationStatus: { _, _ in -1743 })
    // When
    let result = sample(r)
    // Then
    XCTAssertEqual(
      result,
      Sample(
        app: "Safari", bundleId: "com.apple.Safari", grant: "denied",
        title: "Example Domain", url: nil, idleSeconds: 1,
        missing: ["automation:com.apple.Safari"]))
  }

  func testUrlNullAndNothingMissingForANonBrowser() {
    // Given: a non-browser app is front
    let r = reads(
      front: textEdit, axTrusted: true, title: "Untitled", runScript: { _ in nil })
    // When
    let result = sample(r)
    // Then
    XCTAssertNil(result.url)
    XCTAssertEqual(result.missing, [])
  }

  func testAppNullWhenThereIsNoFrontmostApp() {
    // Given: no frontmost app
    let r = reads(front: nil, axTrusted: true, title: nil, runScript: { _ in nil })
    // When
    let result = sample(r)
    // Then
    XCTAssertEqual(
      result,
      Sample(app: nil, bundleId: nil, title: nil, url: nil, idleSeconds: 1, missing: []))
  }

  func testAppNullForTheLoginWindow() {
    // Given: the login window is front
    let r = reads(
      front: loginWindow, axTrusted: true, title: "Login", runScript: { _ in nil })
    // When
    let result = sample(r)
    // Then
    XCTAssertEqual(
      result,
      Sample(app: nil, bundleId: nil, title: nil, url: nil, idleSeconds: 1, missing: []))
  }

  func testGrantGrantedForABrowserWithAUrl() {
    // Given: Safari front with a granted URL read
    let r = reads(
      front: safari, axTrusted: true, title: "Example Domain",
      runScript: { _ in "https://example.com/" },
      safariPrivateFormats: safariFormats)
    // When
    let result = sample(r)
    // Then
    XCTAssertEqual(result.grant, "granted")
  }

  func testGrantDeniedForADeniedBrowser() {
    // Given: Safari front with a denied Grant
    let r = reads(
      front: safari, axTrusted: true, title: "Example Domain",
      runScript: { _ in "https://example.com/" },
      automationStatus: { _, _ in -1743 })
    // When
    let result = sample(r)
    // Then
    XCTAssertEqual(result.grant, "denied")
    XCTAssertEqual(result.missing, ["automation:com.apple.Safari"])
  }

  func testGrantNullForANonBrowser() {
    // Given: a non-browser front
    let r = reads(front: finder, axTrusted: true, title: "Desktop", runScript: { _ in nil })
    // When
    let result = sample(r)
    // Then
    XCTAssertNil(result.grant)
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
        app: "Safari", bundleId: "com.apple.Safari", grant: "granted",
        title: "Example Domain", url: "https://example.com/", idleSeconds: 1,
        missing: []))
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
    XCTAssertEqual(sample.grant, "denied")
    XCTAssertNil(sample.url)
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
    XCTAssertNil(sample.grant)
    XCTAssertNil(sample.url)
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
        app: "Google Chrome", bundleId: "com.google.Chrome", grant: "noAnswer",
        title: "Inbox", url: nil, idleSeconds: 1,
        missing: ["automation:com.google.Chrome"]))
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
        app: "Google Chrome", bundleId: "com.google.Chrome", grant: "notAsked",
        title: "Inbox", url: nil, idleSeconds: 1,
        missing: ["automation:com.google.Chrome"]))
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
    XCTAssertEqual(sample.missing, ["accessibility"])
    XCTAssertEqual(titleCalls, [])
  }
}
