import XCTest

@testable import HelperCore

final class VersionTests: XCTestCase {
  // The release script reads this version.
  func testVersionIsSemver() {
    // Given: the helper version string
    let pattern = "^[0-9]+\\.[0-9]+\\.[0-9]+$"
    // When
    let match = HelperCore.version.range(of: pattern, options: .regularExpression)
    // Then
    XCTAssertNotNil(match)
    XCTAssertFalse(HelperCore.version.isEmpty)
  }
}
