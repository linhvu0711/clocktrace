import XCTest

@testable import HelperCore

final class BiomeCommandsTests: XCTestCase {
  private var fixture: Data {
    let url = Bundle.module.url(
      forResource: "infocus", withExtension: "segb", subdirectory: "Fixtures")!
    return try! Data(contentsOf: url)
  }

  private func reads(
    canOpenSyncDb: @escaping () -> Bool = { true },
    deviceFolders: @escaping () -> [String]? = { ["a-device"] },
    segments: @escaping (String) -> SegmentsRead = { _ in
      .listed([BiomeSegment(name: "1", modifiedAt: 100)])
    },
    segmentData: ((String, String) -> Data?)? = nil,
    devicePeers: @escaping () -> DevicePeerRead = { .rows([]) }
  ) -> BiomeReads {
    BiomeReads(
      canOpenSyncDb: canOpenSyncDb,
      deviceFolders: deviceFolders,
      segments: segments,
      segmentData: segmentData ?? { _, _ in self.fixture },
      devicePeers: devicePeers
    )
  }

  func testDecodesTheFixtureToTheExpectedLines() {
    // Given: the fixture segment and its expected lines
    let data = fixture
    let expectedUrl = Bundle.module.url(
      forResource: "infocus.expected", withExtension: "jsonl", subdirectory: "Fixtures")!
    let expected = try! String(contentsOf: expectedUrl, encoding: .utf8)
    // When
    let actual =
      decodeSegment(data, device: "fixture-device", segment: "infocus.segb")
      .map { $0.json() }
      .joined(separator: "\n") + "\n"
    // Then
    XCTAssertEqual(actual, expected)
  }

  func testReportsAParseErrorForASegmentWithoutTheMagic() {
    // Given: bytes that are not a segment
    let data = Data("not a segment".utf8)
    // When
    let lines = decodeSegment(data, device: "a-device", segment: "1")
    // Then
    XCTAssertEqual(
      lines,
      [.parseError(BiomeParseErrorLine(segment: "1", offset: 0))])
  }

  func testReportsAParseErrorForAnEntryWhoseCrc32DoesNotMatchAndKeepsTheOthers() {
    // Given: the fixture with the last payload byte of the entry at offset 32 flipped
    var data = fixture
    data[105] ^= 0xff
    // When
    let lines =
      decodeSegment(data, device: "fixture-device", segment: "infocus.segb")
      .map { $0.json() }
    // Then
    XCTAssertEqual(
      lines,
      [
        "{\"error\":\"parse\",\"offset\":32,\"segment\":\"infocus.segb\"}",
        "{\"appVersion\":null,\"build\":null,\"bundleId\":\"com.example.alpha\",\"device\":\"fixture-device\",\"focus\":\"end\",\"offset\":108,\"reason\":null,\"segment\":\"infocus.segb\",\"ts\":1758307260.25}",
        "{\"error\":\"parse\",\"offset\":148,\"segment\":\"infocus.segb\"}",
      ])
  }

  func testExits3WithoutFullDiskAccess() {
    // Given: reads whose sync.db does not open
    let reads = reads(canOpenSyncDb: { false })
    var out: [String] = []
    var err: [String] = []
    // When
    let code = biomeRecords(
      reads: reads, since: nil, emit: { out.append($0) }, emitError: { err.append($0) })
    // Then
    XCTAssertEqual(code, 3)
    XCTAssertEqual(out, [])
    XCTAssertEqual(err, ["full disk access needed"])
  }

  func testExits4WithoutTheRemoteFolder() {
    // Given: reads whose remote folder listing fails
    let reads = reads(deviceFolders: { nil })
    var out: [String] = []
    var err: [String] = []
    // When
    let code = biomeRecords(
      reads: reads, since: nil, emit: { out.append($0) }, emitError: { err.append($0) })
    // Then
    XCTAssertEqual(code, 4)
    XCTAssertEqual(out, [])
    XCTAssertEqual(err, ["no App.InFocus remote folder"])
  }

  func testPrintsNothingWithoutDevices() {
    // Given: an empty remote folder
    let reads = reads(deviceFolders: { [] })
    var out: [String] = []
    var err: [String] = []
    // When
    let code = biomeRecords(
      reads: reads, since: nil, emit: { out.append($0) }, emitError: { err.append($0) })
    // Then
    XCTAssertEqual(code, 0)
    XCTAssertEqual(out, [])
    XCTAssertEqual(err, [])
  }

  func testPrintsRecordsInDeviceSegmentAndOffsetOrder() {
    // Given: two devices out of order, one with two segments out of order
    let reads = reads(
      deviceFolders: { ["b-device", "a-device"] },
      segments: {
        $0 == "a-device"
          ? .listed([
            BiomeSegment(name: "2", modifiedAt: 100),
            BiomeSegment(name: "1", modifiedAt: 100),
          ])
          : .listed([BiomeSegment(name: "1", modifiedAt: 100)])
      })
    var out: [String] = []
    var err: [String] = []
    // When
    let code = biomeRecords(
      reads: reads, since: nil, emit: { out.append($0) }, emitError: { err.append($0) })
    // Then
    XCTAssertEqual(code, 0)
    XCTAssertEqual(err, [])
    XCTAssertEqual(
      out,
      [
        "{\"appVersion\":\"1.2.3\",\"build\":\"456\",\"bundleId\":\"com.example.alpha\",\"device\":\"a-device\",\"focus\":\"start\",\"offset\":32,\"reason\":\"com.example.reason\",\"segment\":\"1\",\"ts\":1758307200.5}",
        "{\"appVersion\":null,\"build\":null,\"bundleId\":\"com.example.alpha\",\"device\":\"a-device\",\"focus\":\"end\",\"offset\":108,\"reason\":null,\"segment\":\"1\",\"ts\":1758307260.25}",
        "{\"error\":\"parse\",\"offset\":148,\"segment\":\"1\"}",
        "{\"appVersion\":\"1.2.3\",\"build\":\"456\",\"bundleId\":\"com.example.alpha\",\"device\":\"a-device\",\"focus\":\"start\",\"offset\":32,\"reason\":\"com.example.reason\",\"segment\":\"2\",\"ts\":1758307200.5}",
        "{\"appVersion\":null,\"build\":null,\"bundleId\":\"com.example.alpha\",\"device\":\"a-device\",\"focus\":\"end\",\"offset\":108,\"reason\":null,\"segment\":\"2\",\"ts\":1758307260.25}",
        "{\"error\":\"parse\",\"offset\":148,\"segment\":\"2\"}",
        "{\"appVersion\":\"1.2.3\",\"build\":\"456\",\"bundleId\":\"com.example.alpha\",\"device\":\"b-device\",\"focus\":\"start\",\"offset\":32,\"reason\":\"com.example.reason\",\"segment\":\"1\",\"ts\":1758307200.5}",
        "{\"appVersion\":null,\"build\":null,\"bundleId\":\"com.example.alpha\",\"device\":\"b-device\",\"focus\":\"end\",\"offset\":108,\"reason\":null,\"segment\":\"1\",\"ts\":1758307260.25}",
        "{\"error\":\"parse\",\"offset\":148,\"segment\":\"1\"}",
      ])
  }

  func testSkipsSegmentsOlderThanSince() {
    // Given: two segments, only "2" newer than the --since flag
    let reads = reads(segments: { _ in
      .listed([BiomeSegment(name: "1", modifiedAt: 100), BiomeSegment(name: "2", modifiedAt: 200)])
    })
    var out: [String] = []
    var err: [String] = []
    // When
    let code = biomeRecords(
      reads: reads, since: 150, emit: { out.append($0) }, emitError: { err.append($0) })
    // Then
    XCTAssertEqual(code, 0)
    XCTAssertEqual(err, [])
    XCTAssertEqual(out.count, 3)
    XCTAssertEqual(
      out.first,
      "{\"appVersion\":\"1.2.3\",\"build\":\"456\",\"bundleId\":\"com.example.alpha\",\"device\":\"a-device\",\"focus\":\"start\",\"offset\":32,\"reason\":\"com.example.reason\",\"segment\":\"2\",\"ts\":1758307200.5}")
  }

  func testKeepsASegmentModifiedExactlyAtSince() {
    // Given: one segment modified exactly at the --since flag
    let reads = reads(segments: { _ in .listed([BiomeSegment(name: "1", modifiedAt: 150)]) })
    var out: [String] = []
    var err: [String] = []
    // When
    let code = biomeRecords(
      reads: reads, since: 150, emit: { out.append($0) }, emitError: { err.append($0) })
    // Then
    XCTAssertEqual(code, 0)
    XCTAssertEqual(err, [])
    XCTAssertEqual(out.count, 3)
  }

  func testContinuesAfterAnUnreadableSegmentAndExits0() {
    // Given: segment "1" cannot be read, segment "2" is the fixture
    let fixture = self.fixture
    let reads = reads(
      segments: { _ in
        .listed([BiomeSegment(name: "1", modifiedAt: 100), BiomeSegment(name: "2", modifiedAt: 100)])
      },
      segmentData: { _, name in name == "1" ? nil : fixture })
    var out: [String] = []
    var err: [String] = []
    // When
    let code = biomeRecords(
      reads: reads, since: nil, emit: { out.append($0) }, emitError: { err.append($0) })
    // Then
    XCTAssertEqual(code, 0)
    XCTAssertEqual(err, [])
    XCTAssertEqual(out.count, 4)
    XCTAssertEqual(out.first, "{\"error\":\"parse\",\"offset\":0,\"segment\":\"1\"}")
  }

  func testContinuesAfterASegmentWithoutTheMagic() {
    // Given: segment "1" is not SEGB, segment "2" is the fixture
    let fixture = self.fixture
    let reads = reads(
      segments: { _ in
        .listed([BiomeSegment(name: "1", modifiedAt: 100), BiomeSegment(name: "2", modifiedAt: 100)])
      },
      segmentData: { _, name in name == "1" ? Data("not a segment".utf8) : fixture })
    var out: [String] = []
    var err: [String] = []
    // When
    let code = biomeRecords(
      reads: reads, since: nil, emit: { out.append($0) }, emitError: { err.append($0) })
    // Then
    XCTAssertEqual(code, 0)
    XCTAssertEqual(err, [])
    XCTAssertEqual(out.count, 4)
    XCTAssertEqual(out.first, "{\"error\":\"parse\",\"offset\":0,\"segment\":\"1\"}")
  }

  func testContinuesAfterAnUnlistableDeviceFolderAndExits6() {
    // Given: a-device cannot be listed, b-device holds the fixture
    let reads = reads(
      deviceFolders: { ["a-device", "b-device"] },
      segments: {
        $0 == "a-device"
          ? .failed("/remote/a-device: Permission denied")
          : .listed([BiomeSegment(name: "1", modifiedAt: 100)])
      })
    var out: [String] = []
    var err: [String] = []
    // When
    let code = biomeRecords(
      reads: reads, since: nil, emit: { out.append($0) }, emitError: { err.append($0) })
    // Then
    XCTAssertEqual(code, 6)
    XCTAssertEqual(err, ["cannot list /remote/a-device: Permission denied"])
    XCTAssertEqual(out.count, 3)
    XCTAssertEqual(
      out.first,
      "{\"appVersion\":\"1.2.3\",\"build\":\"456\",\"bundleId\":\"com.example.alpha\",\"device\":\"b-device\",\"focus\":\"start\",\"offset\":32,\"reason\":\"com.example.reason\",\"segment\":\"1\",\"ts\":1758307200.5}")
  }

  func testPrintsNothingAndExits0ForADeviceWithoutSegments() {
    // Given: a device whose folders hold no segment file
    let reads = reads(segments: { _ in .listed([]) })
    var out: [String] = []
    var err: [String] = []
    // When
    let code = biomeRecords(
      reads: reads, since: nil, emit: { out.append($0) }, emitError: { err.append($0) })
    // Then
    XCTAssertEqual(code, 0)
    XCTAssertEqual(out, [])
    XCTAssertEqual(err, [])
  }

  func testPrintsOneLinePerDevicePeerRow() {
    // Given: two DevicePeer rows
    let reads = reads(devicePeers: {
      .rows([
        DevicePeerLine(
          deviceIdentifier: "00000000-0000-4000-8000-000000000001",
          me: true,
          name: "",
          model: "26A428",
          platform: 3,
          lastSyncDate: nil
        ),
        DevicePeerLine(
          deviceIdentifier: "00000000-0000-4000-8000-000000000002",
          me: false,
          name: "",
          model: "24A437",
          platform: 2,
          lastSyncDate: 1790044540.0484
        ),
      ])
    })
    var out: [String] = []
    var err: [String] = []
    // When
    let code = biomeDevices(
      reads: reads, emit: { out.append($0) }, emitError: { err.append($0) })
    // Then
    XCTAssertEqual(code, 0)
    XCTAssertEqual(err, [])
    XCTAssertEqual(
      out,
      [
        "{\"deviceIdentifier\":\"00000000-0000-4000-8000-000000000001\",\"lastSyncDate\":null,\"me\":true,\"model\":\"26A428\",\"name\":\"\",\"platform\":3}",
        "{\"deviceIdentifier\":\"00000000-0000-4000-8000-000000000002\",\"lastSyncDate\":1790044540.0484,\"me\":false,\"model\":\"24A437\",\"name\":\"\",\"platform\":2}",
      ])
  }

  func testExits3WithoutFullDiskAccessForDevices() {
    // Given: reads whose sync.db does not open
    let reads = reads(canOpenSyncDb: { false })
    var out: [String] = []
    var err: [String] = []
    // When
    let code = biomeDevices(
      reads: reads, emit: { out.append($0) }, emitError: { err.append($0) })
    // Then
    XCTAssertEqual(code, 3)
    XCTAssertEqual(out, [])
    XCTAssertEqual(err, ["full disk access needed"])
  }

  func testExits5WhenDevicePeerCannotBeRead() {
    // Given: the DevicePeer read fails
    let reads = reads(devicePeers: { .failed("no such table: DevicePeer") })
    var out: [String] = []
    var err: [String] = []
    // When
    let code = biomeDevices(
      reads: reads, emit: { out.append($0) }, emitError: { err.append($0) })
    // Then
    XCTAssertEqual(code, 5)
    XCTAssertEqual(out, [])
    XCTAssertEqual(err, ["cannot read DevicePeer: no such table: DevicePeer"])
  }
}
