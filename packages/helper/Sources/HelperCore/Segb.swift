import Foundation

public struct SegbEntry: Equatable {
  public var offset: Int
  public var payload: Data

  public init(offset: Int, payload: Data) {
    self.offset = offset
    self.payload = payload
  }
}

public enum SegbRead: Equatable {
  case entries([SegbEntry])
  case notSegb
}

public func readSegb(_ data: Data) -> SegbRead {
  guard data.count >= 32 else { return .notSegb }
  let ints: [Int32] = data.withUnsafeBytes { raw in
    (0..<data.count / 4).map {
      raw.loadUnaligned(fromByteOffset: $0 * 4, as: Int32.self)
    }
  }
  guard ints[0] == 0x4247_4553 else { return .notSegb }  // "SEGB" little-endian
  let count = Int(ints[1])
  guard count >= 0, 32 + 16 * count <= data.count else { return .notSegb }

  let trailerStart = data.count - 16 * count
  var slots: [(endOffset: Int, state: Int)] = []
  for k in 0..<count {
    let base = trailerStart + 16 * k
    slots.append((endOffset: Int(ints[base / 4]), state: Int(ints[base / 4 + 1])))
  }
  slots = slots.filter { $0.state == 1 || $0.state == 3 || $0.state == 4 }
    .sorted { $0.endOffset < $1.endOffset }

  var entries: [SegbEntry] = []
  var pos = 32
  var previous: Int? = nil
  for slot in slots {
    if slot.state == 4 { continue }
    if slot.endOffset == previous { continue }
    let entryStart = pos
    let length = slot.endOffset + 32 - pos
    if length < 8 { continue }
    if pos + length > trailerStart { break }
    previous = slot.endOffset
    pos += length
    if slot.endOffset % 4 != 0 {
      pos += 4 - slot.endOffset % 4
    }
    if slot.state == 1 {
      let payload = data[(entryStart + 8)..<(entryStart + length)]
      entries.append(SegbEntry(offset: entryStart, payload: payload))
    }
  }
  return .entries(entries)
}
