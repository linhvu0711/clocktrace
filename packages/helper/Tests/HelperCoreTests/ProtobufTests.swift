import XCTest

@testable import HelperCore

final class ProtobufTests: XCTestCase {
  func testReadsAVarintADoubleAndAString() {
    // Given: field 1 varint 150, field 4 i64 of 1.0, field 2 string "testing"
    let data = Data([
      0x08, 0x96, 0x01, 0x21, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0, 0x3f, 0x12, 0x07,
      0x74, 0x65, 0x73, 0x74, 0x69, 0x6e, 0x67,
    ])
    // When
    let fields = protobufFields(data)
    // Then
    XCTAssertEqual(
      fields,
      [
        ProtobufField(number: 1, value: .varint(150)),
        ProtobufField(number: 4, value: .i64(0x3ff0000000000000)),
        ProtobufField(number: 2, value: .len(Data("testing".utf8))),
      ])
  }

  func testReadsAnI32Field() {
    // Given: field 5 i32 1, field 1 varint 1
    let data = Data([0x2d, 0x01, 0x00, 0x00, 0x00, 0x08, 0x01])
    // When
    let fields = protobufFields(data)
    // Then
    XCTAssertEqual(
      fields,
      [
        ProtobufField(number: 5, value: .i32(1)),
        ProtobufField(number: 1, value: .varint(1)),
      ])
  }

  func testReadsAnEmptyMessage() {
    // Given: empty data
    let data = Data()
    // When
    let fields = protobufFields(data)
    // Then
    XCTAssertEqual(fields, [])
  }

  func testReturnsNilForATruncatedString() {
    // Given: field 2 declares length 7, only 2 bytes follow
    let data = Data([0x12, 0x07, 0x74, 0x65])
    // When
    let fields = protobufFields(data)
    // Then
    XCTAssertNil(fields)
  }

  func testReturnsNilForAVarintOver10Bytes() {
    // Given: 11 continuation bytes
    let data = Data(repeating: 0xff, count: 11)
    // When
    let fields = protobufFields(data)
    // Then
    XCTAssertNil(fields)
  }

  func testReturnsNilForAGroupWireType() {
    // Given: tag of field 1 with wire type 3
    let data = Data([0x0b])
    // When
    let fields = protobufFields(data)
    // Then
    XCTAssertNil(fields)
  }

  func testReturnsNilForFieldNumberZero() {
    // Given: tag 0 followed by a varint
    let data = Data([0x00, 0x01])
    // When
    let fields = protobufFields(data)
    // Then
    XCTAssertNil(fields)
  }
}
