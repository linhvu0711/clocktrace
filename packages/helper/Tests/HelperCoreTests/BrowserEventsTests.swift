import XCTest

@testable import HelperCore

final class BrowserEventsTests: XCTestCase {
  func testMapsSafari() {
    // Given: "com.apple.Safari"
    // When / Then
    XCTAssertEqual(
      browserEvents(bundleId: "com.apple.Safari"),
      BrowserEvents(bundleId: "com.apple.Safari", properties: [["cTab", "pURL"]])
    )
  }

  func testMapsChrome() {
    XCTAssertEqual(
      browserEvents(bundleId: "com.google.Chrome"),
      BrowserEvents(bundleId: "com.google.Chrome", properties: [["mode"], ["acTa", "URL "]])
    )
  }

  func testMapsChromium() {
    XCTAssertEqual(
      browserEvents(bundleId: "org.chromium.Chromium"),
      BrowserEvents(
        bundleId: "org.chromium.Chromium", properties: [["mode"], ["acTa", "URL "]])
    )
  }

  func testMapsEdge() {
    XCTAssertEqual(
      browserEvents(bundleId: "com.microsoft.edgemac"),
      BrowserEvents(
        bundleId: "com.microsoft.edgemac", properties: [["mode"], ["acTa", "URL "]])
    )
  }

  func testMapsBrave() {
    XCTAssertEqual(
      browserEvents(bundleId: "com.brave.Browser"),
      BrowserEvents(bundleId: "com.brave.Browser", properties: [["mode"], ["acTa", "URL "]])
    )
  }

  func testMapsVivaldi() {
    XCTAssertEqual(
      browserEvents(bundleId: "com.vivaldi.Vivaldi"),
      BrowserEvents(
        bundleId: "com.vivaldi.Vivaldi", properties: [["mode"], ["acTa", "URL "]])
    )
  }

  func testMapsOpera() {
    XCTAssertEqual(
      browserEvents(bundleId: "com.operasoftware.Opera"),
      BrowserEvents(
        bundleId: "com.operasoftware.Opera", properties: [["mode"], ["acTa", "URL "]])
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
    XCTAssertNil(browserEvents(bundleId: "com.apple.TextEdit"))
  }
}
