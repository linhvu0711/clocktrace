import XCTest

@testable import HelperCore

final class LineTests: XCTestCase {
  func testEncodesNilFieldsAsNullInKeyOrder() {
    // Given: a line with all optional fields nil
    let line = Line(
      ts: "2026-01-01T00:00:00.000Z",
      app: nil,
      bundleId: nil,
      title: nil,
      url: nil,
      idleSeconds: 1.5,
      missing: []
    )
    // When
    let json = line.json()
    // Then
    XCTAssertEqual(
      json,
      "{\"app\":null,\"bundleId\":null,\"grant\":null,\"idleSeconds\":1.5,\"missing\":[],\"title\":null,\"ts\":\"2026-01-01T00:00:00.000Z\",\"url\":null}"
    )
  }

  func testKeepsSlashesInUrlUnescaped() {
    // Given: a line with a url containing slashes
    let line = Line(
      ts: "2026-01-01T00:00:00.000Z",
      app: "Safari",
      bundleId: "com.apple.Safari",
      title: "Example Domain",
      url: "https://example.com/a?b=1",
      idleSeconds: 0,
      missing: []
    )
    // When
    let json = line.json()
    // Then
    XCTAssertEqual(
      json,
      "{\"app\":\"Safari\",\"bundleId\":\"com.apple.Safari\",\"grant\":null,\"idleSeconds\":0,\"missing\":[],\"title\":\"Example Domain\",\"ts\":\"2026-01-01T00:00:00.000Z\",\"url\":\"https://example.com/a?b=1\"}"
    )
  }

  func testEncodesGrant() {
    // Given: a line carrying a denied Grant
    let line = Line(
      ts: "2026-01-01T00:00:00.000Z",
      app: "Safari",
      bundleId: "com.apple.Safari",
      grant: "denied",
      title: nil,
      url: nil,
      idleSeconds: 0,
      missing: []
    )
    // When
    let json = line.json()
    // Then
    XCTAssertEqual(
      json,
      "{\"app\":\"Safari\",\"bundleId\":\"com.apple.Safari\",\"grant\":\"denied\",\"idleSeconds\":0,\"missing\":[],\"title\":null,\"ts\":\"2026-01-01T00:00:00.000Z\",\"url\":null}"
    )
  }
}

