import XCTest

@testable import HelperCore

final class SafariPrivateTitleTests: XCTestCase {
  func testMatchesTheEnglishSuffix() {
    // Given: the English format
    let formats = ["%@, Private Browsing"]
    // When
    let result = isSafariPrivateTitle("Example Domain, Private Browsing", formats: formats)
    // Then
    XCTAssertTrue(result)
  }

  func testDoesNotMatchANormalTitle() {
    // Given: the English format
    let formats = ["%@, Private Browsing"]
    // When
    let result = isSafariPrivateTitle("Example Domain", formats: formats)
    // Then
    XCTAssertFalse(result)
  }

  func testMatchesAThaiPrefix() {
    // Given: the Thai format, whose private text comes before the title
    let formats = ["ท่องเว็บแบบส่วนตัวเรื่อง%[tt]@"]
    // When
    let result = isSafariPrivateTitle(
      "ท่องเว็บแบบส่วนตัวเรื่องExample Domain", formats: formats)
    // Then
    XCTAssertTrue(result)
  }

  func testIgnoresDirectionMarks() {
    // Given: the Arabic format, which starts with a right-to-left mark
    let formats = ["\u{200F}%@، التصفح الخاص"]
    // When
    let result = isSafariPrivateTitle("Example Domain، التصفح الخاص", formats: formats)
    // Then
    XCTAssertTrue(result)
  }
}
