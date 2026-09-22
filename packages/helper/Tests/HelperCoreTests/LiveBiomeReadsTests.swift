import XCTest

@testable import HelperCore

final class LiveBiomeReadsTests: XCTestCase {
  private var root = ""

  override func setUpWithError() throws {
    root = FileManager.default.temporaryDirectory
      .appendingPathComponent("LiveBiomeReadsTests-\(UUID().uuidString)").path
    try FileManager.default.createDirectory(atPath: root, withIntermediateDirectories: true)
  }

  override func tearDownWithError() throws {
    try? FileManager.default.setAttributes(
      [.posixPermissions: 0o755], ofItemAtPath: root + "/a-device")
    try FileManager.default.removeItem(atPath: root)
  }

  private func write(_ relative: String, mtime: Double) throws {
    let path = root + "/" + relative
    try FileManager.default.createDirectory(
      atPath: (path as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
    FileManager.default.createFile(atPath: path, contents: Data("x".utf8))
    try FileManager.default.setAttributes(
      [.modificationDate: Date(timeIntervalSince1970: mtime)], ofItemAtPath: path)
  }

  func testListsSegmentFilesByNameWithTheirOwnModificationTime() throws {
    // Given: two segment files out of order, a dot file, and a tombstone/ subfolder
    try write("a-device/2", mtime: 200)
    try write("a-device/1", mtime: 100)
    try write("a-device/.DS_Store", mtime: 300)
    try write("a-device/tombstone/3", mtime: 400)
    // When
    let read = BiomeReads.live(remotePath: root).segments("a-device")
    // Then
    XCTAssertEqual(
      read,
      .listed([
        BiomeSegment(name: "1", modifiedAt: 100),
        BiomeSegment(name: "2", modifiedAt: 200),
      ]))
  }

  func testReadsASegmentsBytes() throws {
    // Given: one segment file
    try write("a-device/1", mtime: 100)
    // When
    let data = BiomeReads.live(remotePath: root).segmentData("a-device", "1")
    // Then
    XCTAssertEqual(data, Data("x".utf8))
  }

  func testListsNothingForADeviceWhoseFolderIsEmpty() throws {
    // Given: a device folder with no files
    try FileManager.default.createDirectory(
      atPath: root + "/a-device", withIntermediateDirectories: true)
    // When
    let read = BiomeReads.live(remotePath: root).segments("a-device")
    // Then
    XCTAssertEqual(read, .listed([]))
  }

  func testFailsWithTheFolderPathWhenTheDeviceFolderIsNotAFolder() throws {
    // Given: a regular file where a device folder is expected
    try write("plain", mtime: 100)
    // When
    let read = BiomeReads.live(remotePath: root).segments("plain")
    // Then
    XCTAssertEqual(read, .failed("\(root)/plain: Not a directory"))
  }

  func testFailsWithTheFolderPathWhenTheDeviceFolderCannotBeRead() throws {
    // Given: a device folder without read permission
    try XCTSkipIf(getuid() == 0, "root ignores permission bits")
    try write("a-device/1", mtime: 100)
    try FileManager.default.setAttributes(
      [.posixPermissions: 0o000], ofItemAtPath: root + "/a-device")
    // When
    let read = BiomeReads.live(remotePath: root).segments("a-device")
    // Then
    XCTAssertEqual(read, .failed("\(root)/a-device: Permission denied"))
  }
}
