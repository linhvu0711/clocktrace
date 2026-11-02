import XCTest

@testable import HelperCore

final class VersionTests: XCTestCase {
  func testVersionMatchesSemver() {
    // Given: the helper version string
    let pattern = "^[0-9]+\\.[0-9]+\\.[0-9]+$"
    // When
    let match = HelperCore.version.range(of: pattern, options: .regularExpression)
    // Then
    XCTAssertNotNil(match)
  }
}
