import Foundation

public struct BiomeSegment: Equatable {
  public var name: String
  public var modifiedAt: Double

  public init(name: String, modifiedAt: Double) {
    self.name = name
    self.modifiedAt = modifiedAt
  }
}

public enum DevicePeerRead: Equatable {
  case rows([DevicePeerLine])
  case failed(String)
}

public struct BiomeReads {
  public var canOpenSyncDb: () -> Bool
  public var deviceFolders: () -> [String]?
  public var segments: (String) -> [BiomeSegment]
  public var segmentData: (String, String) -> Data?
  public var devicePeers: () -> DevicePeerRead

  public init(
    canOpenSyncDb: @escaping () -> Bool,
    deviceFolders: @escaping () -> [String]?,
    segments: @escaping (String) -> [BiomeSegment],
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
