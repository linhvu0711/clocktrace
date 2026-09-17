import XCTest

@testable import HelperCore

final class CommandTests: XCTestCase {
  func testParsesVersion() {
    // Given: args ["--version"]
    let args = ["--version"]
    // When
    let command = Command.parse(args)
    // Then
    XCTAssertEqual(command, .version)
  }

  func testParsesWatch() {
    // Given: args ["watch"]
    let args = ["watch"]
    // When
    let command = Command.parse(args)
    // Then
    XCTAssertEqual(command, .watch)
  }

  func testReturnsUsageForAnUnknownSubcommand() {
    // Given: args ["bogus"]
    let args = ["bogus"]
    // When
    let command = Command.parse(args)
    // Then
    XCTAssertEqual(command, .usage)
  }

  func testReturnsUsageWithNoArguments() {
    // Given: args []
    let args: [String] = []
    // When
    let command = Command.parse(args)
    // Then
    XCTAssertEqual(command, .usage)
  }
}
