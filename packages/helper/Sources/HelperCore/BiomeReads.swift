import Foundation

public enum DevicePeerRead: Equatable {
  case rows([DevicePeerLine])
  case failed(String)
}

/// The segment file names of one device, or the folder that could not be listed
/// as `<folder>: <reason>`.
public enum SegmentsRead: Equatable {
  case listed([String])
  case failed(String)
}

public struct BiomeReads {
  public var canOpenSyncDb: () -> Bool
  public var deviceFolders: () -> [String]?
  public var segments: (String) -> SegmentsRead
  public var segmentData: (String, String) -> Data?
  public var devicePeers: () -> DevicePeerRead

  public init(
    canOpenSyncDb: @escaping () -> Bool,
    deviceFolders: @escaping () -> [String]?,
    segments: @escaping (String) -> SegmentsRead,
    segmentData: @escaping (String, String) -> Data?,
    devicePeers: @escaping () -> DevicePeerRead
  ) {
    self.canOpenSyncDb = canOpenSyncDb
    self.deviceFolders = deviceFolders
    self.segments = segments
    self.segmentData = segmentData
    self.devicePeers = devicePeers
  }
}
