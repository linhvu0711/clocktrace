import XCTest

@testable import HelperCore

final class BrowserScriptTests: XCTestCase {
  func testMapsSafari() {
    // Given: "com.apple.Safari"
    // When / Then
    XCTAssertEqual(
      browserScript(bundleId: "com.apple.Safari"),
      "tell application \"Safari\" to get URL of current tab of front window"
    )
  }

  func testMapsChrome() {
    XCTAssertEqual(
      browserScript(bundleId: "com.google.Chrome"),
      "tell application id \"com.google.Chrome\" to tell front window to return mode & linefeed & URL of active tab"
    )
  }

  func testMapsChromium() {
    XCTAssertEqual(
      browserScript(bundleId: "org.chromium.Chromium"),
      "tell application id \"org.chromium.Chromium\" to tell front window to return mode & linefeed & URL of active tab"
    )
  }

  func testMapsEdge() {
    XCTAssertEqual(
      browserScript(bundleId: "com.microsoft.edgemac"),
      "tell application id \"com.microsoft.edgemac\" to tell front window to return mode & linefeed & URL of active tab"
    )
  }

  func testMapsBrave() {
    XCTAssertEqual(
      browserScript(bundleId: "com.brave.Browser"),
      "tell application id \"com.brave.Browser\" to tell front window to return mode & linefeed & URL of active tab"
    )
  }

  func testMapsVivaldi() {
    XCTAssertEqual(
      browserScript(bundleId: "com.vivaldi.Vivaldi"),
      "tell application id \"com.vivaldi.Vivaldi\" to tell front window to return mode & linefeed & URL of active tab"
    )
  }

  func testMapsOpera() {
    XCTAssertEqual(
      browserScript(bundleId: "com.operasoftware.Opera"),
      "tell application id \"com.operasoftware.Opera\" to tell front window to return mode & linefeed & URL of active tab"
    )
  }

  func testListsSafariAndTheChromeFamily() {
    // Given: nothing
    // When
    let browsers = supportedBrowsers
    // Then
    XCTAssertEqual(
      browsers,
      [
        "com.apple.Safari",
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
    XCTAssertNil(browserScript(bundleId: "com.apple.TextEdit"))
  }
}
