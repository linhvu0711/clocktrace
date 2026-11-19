import XCTest

@testable import HelperCore

final class BrowserEventsTests: XCTestCase {
  private func chromeEvents(_ bundleId: String) -> BrowserEvents {
    BrowserEvents(
      bundleId: bundleId, properties: [["mode"], ["acTa", "URL "]],
      privateWindow: .firstAnswer(normal: "normal", private: "incognito"))
  }

  func testMapsSafari() {
    // Given: "com.apple.Safari"
    // When / Then
    XCTAssertEqual(
      browserEvents(bundleId: "com.apple.Safari"),
      BrowserEvents(
        bundleId: "com.apple.Safari", properties: [["cTab", "pURL"]], privateWindow: .safariTitle)
    )
  }

  func testMapsArdia() {
    // Given: "com.ardia.browser"
    // When / Then
    XCTAssertEqual(
      browserEvents(bundleId: "com.ardia.browser"),
      BrowserEvents(
        bundleId: "com.ardia.browser", properties: [["NNin"], ["acTa", "URL "]],
        privateWindow: .firstAnswer(normal: "false", private: "true"))
    )
  }

  func testMapsChrome() {
    XCTAssertEqual(
      browserEvents(bundleId: "com.google.Chrome"), chromeEvents("com.google.Chrome"))
  }

  func testMapsChromium() {
    XCTAssertEqual(
      browserEvents(bundleId: "org.chromium.Chromium"), chromeEvents("org.chromium.Chromium"))
  }

  func testMapsEdge() {
    XCTAssertEqual(
      browserEvents(bundleId: "com.microsoft.edgemac"), chromeEvents("com.microsoft.edgemac"))
  }

  func testMapsBrave() {
    XCTAssertEqual(
      browserEvents(bundleId: "com.brave.Browser"), chromeEvents("com.brave.Browser"))
  }

  func testMapsVivaldi() {
    XCTAssertEqual(
      browserEvents(bundleId: "com.vivaldi.Vivaldi"), chromeEvents("com.vivaldi.Vivaldi"))
  }

  func testMapsOpera() {
    XCTAssertEqual(
      browserEvents(bundleId: "com.operasoftware.Opera"), chromeEvents("com.operasoftware.Opera"))
  }

  func testListsEveryBrowser() {
    // Given: nothing
    // When
    let browsers = supportedBrowsers
    // Then
    XCTAssertEqual(
      browsers,
      [
        "com.apple.Safari",
        "com.ardia.browser",
        "com.brave.Browser",
        "com.google.Chrome",
        "com.microsoft.edgemac",
        "com.operasoftware.Opera",
        "com.vivaldi.Vivaldi",
        "org.chromium.Chromium",
      ])
  }

  func testReturnsNilForAnyOtherApp() {
    // Given: a non-browser bundle id
    // When / Then
    XCTAssertNil(browserEvents(bundleId: "com.apple.TextEdit"))
  }
}
