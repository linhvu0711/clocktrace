import XCTest

@testable import HelperCore

final class InFocusRecordTests: XCTestCase {
  func testDecodesAStartRecordWithEveryField() {
    // Given: a start record with every field, holding unknown fields 2 and 13
    let payload = Data([
      0x0a, 0x12, 0x63, 0x6f, 0x6d, 0x2e, 0x65, 0x78, 0x61, 0x6d, 0x70, 0x6c, 0x65, 0x2e,
      0x72, 0x65, 0x61, 0x73, 0x6f, 0x6e, 0x10, 0x07, 0x18, 0x01, 0x21, 0x00, 0x00, 0x40,
      0x80, 0xed, 0x3e, 0xc7, 0x41, 0x32, 0x11, 0x63, 0x6f, 0x6d, 0x2e, 0x65, 0x78, 0x61,
      0x6d, 0x70, 0x6c, 0x65, 0x2e, 0x61, 0x6c, 0x70, 0x68, 0x61, 0x4a, 0x05, 0x31, 0x2e,
      0x32, 0x2e, 0x33, 0x52, 0x03, 0x34, 0x35, 0x36, 0x68, 0x03,
    ])
    // When
    let record = inFocusRecord(payload)
    // Then
    XCTAssertEqual(
      record,
      InFocusRecord(
        reason: "com.example.reason",
        focus: .start,
        timestamp: 780000000.5,
        bundleId: "com.example.alpha",
        appVersion: "1.2.3",
        build: "456"
      ))
  }

  func testDecodesAnEndRecordWithoutOptionalFields() {
    // Given: an end record with only fields 3, 4, 6
    let payload = Data([
      0x18, 0x00, 0x21, 0x00, 0x00, 0x20, 0x9e, 0xed, 0x3e, 0xc7, 0x41, 0x32, 0x11, 0x63,
      0x6f, 0x6d, 0x2e, 0x65, 0x78, 0x61, 0x6d, 0x70, 0x6c, 0x65, 0x2e, 0x61, 0x6c, 0x70,
      0x68, 0x61,
    ])
    // When
    let record = inFocusRecord(payload)
    // Then
    XCTAssertEqual(
      record,
      InFocusRecord(
        reason: nil,
        focus: .end,
        timestamp: 780000060.25,
        bundleId: "com.example.alpha",
        appVersion: nil,
        build: nil
      ))
  }

  func testReturnsNilWithoutABundleId() {
    // Given: a record with fields 3 and 4 but no 6
    let payload = Data([0x18, 0x01, 0x21, 0x00, 0x00, 0x40, 0x80, 0xed, 0x3e, 0xc7, 0x41])
    // When
    let record = inFocusRecord(payload)
    // Then
    XCTAssertNil(record)
  }

  func testReturnsNilForAFocusValueOutsideZeroAndOne() {
    // Given: a record whose field 3 is 2
    let payload = Data([
      0x18, 0x02, 0x21, 0x00, 0x00, 0x40, 0x80, 0xed, 0x3e, 0xc7, 0x41, 0x32, 0x01, 0x61,
    ])
    // When
    let record = inFocusRecord(payload)
    // Then
    XCTAssertNil(record)
  }

  func testReturnsNilForBytesThatAreNotProtobuf() {
    // Given: 11 continuation bytes
    let payload = Data(repeating: 0xff, count: 11)
    // When
    let record = inFocusRecord(payload)
    // Then
    XCTAssertNil(record)
  }
}
