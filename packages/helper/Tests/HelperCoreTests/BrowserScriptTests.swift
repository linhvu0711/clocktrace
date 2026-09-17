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
      "tell application id \"com.google.Chrome\" to get URL of active tab of front window"
    )
  }

  func testMapsChromium() {
    XCTAssertEqual(
      browserScript(bundleId: "org.chromium.Chromium"),
      "tell application id \"org.chromium.Chromium\" to get URL of active tab of front window"
    )
  }

  func testMapsEdge() {
    XCTAssertEqual(
      browserScript(bundleId: "com.microsoft.edgemac"),
      "tell application id \"com.microsoft.edgemac\" to get URL of active tab of front window"
    )
  }

  func testMapsBrave() {
    XCTAssertEqual(
      browserScript(bundleId: "com.brave.Browser"),
      "tell application id \"com.brave.Browser\" to get URL of active tab of front window"
    )
  }

  func testMapsVivaldi() {
    XCTAssertEqual(
      browserScript(bundleId: "com.vivaldi.Vivaldi"),
      "tell application id \"com.vivaldi.Vivaldi\" to get URL of active tab of front window"
    )
  }

  func testMapsOpera() {
    XCTAssertEqual(
      browserScript(bundleId: "com.operasoftware.Opera"),
      "tell application id \"com.operasoftware.Opera\" to get URL of active tab of front window"
    )
  }

  func testReturnsNilForAnyOtherApp() {
    // Given: a non-browser bundle id
    // When / Then
    XCTAssertNil(browserScript(bundleId: "com.apple.TextEdit"))
  }
}
