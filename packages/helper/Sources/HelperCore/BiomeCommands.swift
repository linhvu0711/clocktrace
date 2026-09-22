import Foundation

public func decodeSegment(_ data: Data, device: String, segment: String) -> [BiomeLine] {
  guard case .entries(let entries) = readSegb(data) else {
    return [.parseError(BiomeParseErrorLine(segment: segment, offset: 0))]
  }
  return entries.map { entry in
    guard let payload = entry.payload, let record = inFocusRecord(payload) else {
      return .parseError(BiomeParseErrorLine(segment: segment, offset: entry.offset))
    }
    return .record(
      BiomeRecordLine(
        device: device,
        ts: record.timestamp + Date.timeIntervalBetween1970AndReferenceDate,
        focus: record.focus,
        bundleId: record.bundleId,
        reason: record.reason,
        appVersion: record.appVersion,
        build: record.build,
        segment: segment,
        offset: entry.offset
      ))
  }
}

public func biomeRecords(
  reads: BiomeReads = .live,
  since: [String: Int],
  emit: (String) -> Void = HelperCore.emit,
  emitError: (String) -> Void = HelperCore.emitError
) -> Int32 {
  guard reads.canOpenSyncDb() else {
    emitError("full disk access needed")
    return 3
  }
  guard let devices = reads.deviceFolders() else {
    emitError("no App.InFocus remote folder")
    return 4
  }
  var failed = false
  for device in devices.sorted() {
    let segments: [BiomeSegment]
    switch reads.segments(device) {
    case .listed(let listed):
      segments = listed
    case .failed(let message):
      emitError("cannot list \(message)")
      failed = true
      continue
    }
    for segment in segments.sorted(by: { $0.name < $1.name }) {
      if let since = since[device], segment.modifiedAt < Double(since) { continue }
      guard let data = reads.segmentData(device, segment.name) else {
        emit(BiomeLine.parseError(BiomeParseErrorLine(segment: segment.name, offset: 0)).json())
        continue
      }
      for line in decodeSegment(data, device: device, segment: segment.name) {
        emit(line.json())
      }
    }
  }
  return failed ? 6 : 0
}

public func biomeDevices(
  reads: BiomeReads = .live,
  emit: (String) -> Void = HelperCore.emit,
  emitError: (String) -> Void = HelperCore.emitError
) -> Int32 {
  guard reads.canOpenSyncDb() else {
    emitError("full disk access needed")
    return 3
  }
  switch reads.devicePeers() {
  case .rows(let rows):
    for row in rows {
      emit(row.json())
    }
    return 0
  case .failed(let message):
    emitError("cannot read DevicePeer: \(message)")
    return 5
  }
}
