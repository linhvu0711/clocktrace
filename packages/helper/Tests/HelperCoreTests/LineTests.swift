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

  func testWatchLinesMatchTheSharedFile() {
    // Given: one line per watch case, and the shared file the TS tests decode
    let lines = [
      Line(
        ts: "2026-01-01T00:00:00.000Z",
        app: nil,
        bundleId: nil,
        title: nil,
        url: nil,
        idleSeconds: 1.5,
        missing: []
      ),
      Line(
        ts: "2026-01-01T00:00:05.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
        grant: "granted",
        title: "Example Domain",
        url: "https://example.com/a?b=1",
        idleSeconds: 0,
        missing: []
      ),
      Line(
        ts: "2026-01-01T00:00:10.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
        grant: "denied",
        title: nil,
        url: nil,
        idleSeconds: 0,
        missing: ["automation:com.apple.Safari"]
      ),
      Line(
        ts: "2026-01-01T00:00:15.000Z",
        app: "Google Chrome",
        bundleId: "com.google.Chrome",
        grant: "notAsked",
        title: nil,
        url: nil,
        idleSeconds: 2.25,
        missing: ["accessibility", "automation:com.google.Chrome"]
      ),
      Line(
        ts: "2026-01-01T00:00:20.000Z",
        app: "Brave Browser",
        bundleId: "com.brave.Browser",
        grant: "noAnswer",
        title: "New Tab",
        url: nil,
        idleSeconds: 0,
        missing: ["automation:com.brave.Browser"]
      ),
    ]
    let expectedUrl = Bundle.module.url(
      forResource: "watch.expected", withExtension: "jsonl", subdirectory: "Fixtures")!
    let expected = try! String(contentsOf: expectedUrl, encoding: .utf8)
    // When
    let actual = lines.map { $0.json() }.joined(separator: "\n") + "\n"
    // Then
    XCTAssertEqual(actual, expected)
  }
}

