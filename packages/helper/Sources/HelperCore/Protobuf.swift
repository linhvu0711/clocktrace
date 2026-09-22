import Foundation

public enum ProtobufValue: Equatable {
  case varint(UInt64)
  case i64(UInt64)
  case len(Data)
  case i32(UInt32)
}

public struct ProtobufField: Equatable {
  public var number: Int
  public var value: ProtobufValue

  public init(number: Int, value: ProtobufValue) {
    self.number = number
    self.value = value
  }
}

private func readVarint(_ data: Data, _ index: inout Int) -> UInt64? {
  var result: UInt64 = 0
  var shift: UInt64 = 0
  var bytes = 0
  while index < data.endIndex {
    let byte = data[index]
    index += 1
    bytes += 1
    if bytes > 10 { return nil }
    result |= UInt64(byte & 0x7f) << shift
    if byte & 0x80 == 0 { return result }
    shift += 7
  }
  return nil
}

public func protobufFields(_ data: Data) -> [ProtobufField]? {
  var fields: [ProtobufField] = []
  var index = data.startIndex
  while index < data.endIndex {
    guard let tag = readVarint(data, &index) else { return nil }
    let number = Int(tag >> 3)
    let wireType = Int(tag & 7)
    guard number != 0 else { return nil }
    switch wireType {
    case 0:
      guard let value = readVarint(data, &index) else { return nil }
      fields.append(ProtobufField(number: number, value: .varint(value)))
    case 1:
      guard index + 8 <= data.endIndex else { return nil }
      let value = data[index..<index + 8].reversed().reduce(UInt64(0)) {
        $0 << 8 | UInt64($1)
      }
      fields.append(ProtobufField(number: number, value: .i64(value)))
      index += 8
    case 2:
      guard let length = readVarint(data, &index),
        length <= UInt64(data.endIndex - index)
      else { return nil }
      fields.append(
        ProtobufField(number: number, value: .len(data[index..<index + Int(length)])))
      index += Int(length)
    case 5:
      guard index + 4 <= data.endIndex else { return nil }
      let value = data[index..<index + 4].reversed().reduce(UInt32(0)) {
        $0 << 8 | UInt32($1)
      }
      fields.append(ProtobufField(number: number, value: .i32(value)))
      index += 4
    default:
      return nil
    }
  }
  return fields
}
