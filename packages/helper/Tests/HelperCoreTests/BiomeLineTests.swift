import XCTest

@testable import HelperCore

final class BiomeLineTests: XCTestCase {
  func testEncodesARecordInKeyOrder() {
    // Given: a record line with every field set
    let line = BiomeLine.record(
      BiomeRecordLine(
        device: "fixture-device",
        ts: 1758307200.5,
        focus: .start,
        bundleId: "com.example.alpha",
        reason: "com.example.reason",
        appVersion: "1.2.3",
        build: "456",
        segment: "infocus.segb",
        offset: 32
      ))
    // When
    let json = line.json()
    // Then
    XCTAssertEqual(
      json,
      "{\"appVersion\":\"1.2.3\",\"build\":\"456\",\"bundleId\":\"com.example.alpha\",\"device\":\"fixture-device\",\"focus\":\"start\",\"offset\":32,\"reason\":\"com.example.reason\",\"segment\":\"infocus.segb\",\"ts\":1758307200.5}")
  }

  func testEncodesNilFieldsAsNull() {
    // Given: a record line with the optional fields nil
    let line = BiomeLine.record(
      BiomeRecordLine(
        device: "fixture-device",
        ts: 1758307260.25,
        focus: .end,
        bundleId: "com.example.alpha",
        reason: nil,
        appVersion: nil,
        build: nil,
        segment: "infocus.segb",
        offset: 108
      ))
    // When
    let json = line.json()
    // Then
    XCTAssertEqual(
      json,
      "{\"appVersion\":null,\"build\":null,\"bundleId\":\"com.example.alpha\",\"device\":\"fixture-device\",\"focus\":\"end\",\"offset\":108,\"reason\":null,\"segment\":\"infocus.segb\",\"ts\":1758307260.25}")
  }

  func testEncodesAParseError() {
    // Given: a parse error line
    let line = BiomeLine.parseError(BiomeParseErrorLine(segment: "infocus.segb", offset: 148))
    // When
    let json = line.json()
    // Then
    XCTAssertEqual(
      json,
      "{\"error\":\"parse\",\"offset\":148,\"segment\":\"infocus.segb\"}")
  }

  func testEncodesADevicePeerRowWithNulls() {
    // Given: a DevicePeer row with null name and lastSyncDate
    let row = DevicePeerLine(
      deviceIdentifier: "00000000-0000-4000-8000-000000000001",
      me: true,
      name: "",
      model: "26A428",
      platform: 3,
      lastSyncDate: nil
    )
    // When
    let json = row.json()
    // Then
    XCTAssertEqual(
      json,
      "{\"deviceIdentifier\":\"00000000-0000-4000-8000-000000000001\",\"lastSyncDate\":null,\"me\":true,\"model\":\"26A428\",\"name\":\"\",\"platform\":3}")
  }

  func testEncodesADevicePeerRowWithASyncDate() {
    // Given: a DevicePeer row with a lastSyncDate
    let row = DevicePeerLine(
      deviceIdentifier: "00000000-0000-4000-8000-000000000002",
      me: false,
      name: nil,
      model: "24A437",
      platform: 2,
      lastSyncDate: 1790044540.0484
    )
    // When
    let json = row.json()
    // Then
    XCTAssertEqual(
      json,
      "{\"deviceIdentifier\":\"00000000-0000-4000-8000-000000000002\",\"lastSyncDate\":1790044540.0484,\"me\":false,\"model\":\"24A437\",\"name\":null,\"platform\":2}")
  }
}
