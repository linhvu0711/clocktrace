import XCTest

@testable import HelperCore

final class SafariPrivateTitleTests: XCTestCase {
  private var root = ""

  override func setUpWithError() throws {
    root = FileManager.default.temporaryDirectory
      .appendingPathComponent("SafariPrivateTitleTests-\(UUID().uuidString)").path
    try FileManager.default.createDirectory(atPath: root, withIntermediateDirectories: true)
  }

  override func tearDownWithError() throws {
    try FileManager.default.removeItem(atPath: root)
  }

  private func write(_ language: String, _ strings: [String: String]) throws {
    let folder = root + "/" + language + ".lproj"
    try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
    let data = try PropertyListSerialization.data(
      fromPropertyList: strings, format: .binary, options: 0)
    FileManager.default.createFile(atPath: folder + "/Localizable.strings", contents: data)
  }

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

  func testLoadsTheFormatOfEveryLanguage() throws {
    // Given: English and French strings files with the key
    try write("en", ["%@, Private Browsing": "%@, Private Browsing"])
    try write("fr", ["%@, Private Browsing": "%@, navigation privée"])
    // When
    let formats = safariPrivateFormats(resources: root)
    // Then
    XCTAssertEqual(formats, ["%@, Private Browsing", "%@, navigation privée"])
  }

  func testSkipsALanguageWithoutTheKey() throws {
    // Given: English with the key, Base without it
    try write("en", ["%@, Private Browsing": "%@, Private Browsing"])
    try write("Base", ["Other": "Other"])
    // When
    let formats = safariPrivateFormats(resources: root)
    // Then
    XCTAssertEqual(formats, ["%@, Private Browsing"])
  }

  func testLoadsNothingFromAMissingFolder() {
    // Given: a folder that was never created
    let missing = root + "/nope"
    // When
    let formats = safariPrivateFormats(resources: missing)
    // Then
    XCTAssertEqual(formats, [])
  }
}
