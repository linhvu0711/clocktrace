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

  func testParsesPermissions() {
    // Given: args ["permissions"]
    let args = ["permissions"]
    // When
    let command = Command.parse(args)
    // Then
    XCTAssertEqual(command, .permissions)
  }

  func testParsesRequestAccessibility() {
    // Given: args ["permissions", "request", "accessibility"]
    let args = ["permissions", "request", "accessibility"]
    // When
    let command = Command.parse(args)
    // Then
    XCTAssertEqual(command, .requestAccessibility)
  }

  func testParsesRequestAutomationWithABundleId() {
    // Given: args ["permissions", "request", "automation", "com.apple.Safari"]
    let args = ["permissions", "request", "automation", "com.apple.Safari"]
    // When
    let command = Command.parse(args)
    // Then
    XCTAssertEqual(command, .requestAutomation("com.apple.Safari"))
  }

  func testParsesRequestFullDiskAccess() {
    // Given: args ["permissions", "request", "fulldiskaccess"]
    let args = ["permissions", "request", "fulldiskaccess"]
    // When
    let command = Command.parse(args)
    // Then
    XCTAssertEqual(command, .requestFullDiskAccess)
  }

  func testReturnsUsageForAnUnknownRequestName() {
    // Given: args ["permissions", "request", "bogus"]
    let args = ["permissions", "request", "bogus"]
    // When
    let command = Command.parse(args)
    // Then
    XCTAssertEqual(command, .usage)
  }

  func testReturnsUsageForAutomationWithoutABundleId() {
    // Given: args ["permissions", "request", "automation"]
    let args = ["permissions", "request", "automation"]
    // When
    let command = Command.parse(args)
    // Then
    XCTAssertEqual(command, .usage)
  }

  func testParsesBiomeRecords() {
    // Given: args ["biome", "records"]
    let args = ["biome", "records"]
    // When
    let command = Command.parse(args)
    // Then
    XCTAssertEqual(command, .biomeRecords(since: [:]))
  }

  func testParsesBiomeRecordsWithSince() {
    // Given: args ["biome", "records", "--since", "a-device=1758307200"]
    let args = ["biome", "records", "--since", "a-device=1758307200"]
    // When
    let command = Command.parse(args)
    // Then
    XCTAssertEqual(command, .biomeRecords(since: ["a-device": 1758307200]))
  }

  func testParsesBiomeRecordsWithASincePerDevice() {
    // Given: args ["biome", "records", "--since", "a-device=150", "--since", "b-device=200"]
    let args = ["biome", "records", "--since", "a-device=150", "--since", "b-device=200"]
    // When
    let command = Command.parse(args)
    // Then
    XCTAssertEqual(command, .biomeRecords(since: ["a-device": 150, "b-device": 200]))
  }

  func testReturnsUsageForABareSince() {
    // Given: args ["biome", "records", "--since", "5"]
    let args = ["biome", "records", "--since", "5"]
    // When
    let command = Command.parse(args)
    // Then
    XCTAssertEqual(command, .usage)
  }

  func testReturnsUsageForASinceSecondsThatIsNotAnInteger() {
    // Given: args ["biome", "records", "--since", "a-device=soon"]
    let args = ["biome", "records", "--since", "a-device=soon"]
    // When
    let command = Command.parse(args)
    // Then
    XCTAssertEqual(command, .usage)
  }

  func testReturnsUsageForADeviceNamedTwice() {
    // Given: args ["biome", "records", "--since", "a-device=1", "--since", "a-device=2"]
    let args = ["biome", "records", "--since", "a-device=1", "--since", "a-device=2"]
    // When
    let command = Command.parse(args)
    // Then
    XCTAssertEqual(command, .usage)
  }

  func testParsesBiomeDevices() {
    // Given: args ["biome", "devices"]
    let args = ["biome", "devices"]
    // When
    let command = Command.parse(args)
    // Then
    XCTAssertEqual(command, .biomeDevices)
  }

  func testReturnsUsageForBiomeAlone() {
    // Given: args ["biome"]
    let args = ["biome"]
    // When
    let command = Command.parse(args)
    // Then
    XCTAssertEqual(command, .usage)
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
