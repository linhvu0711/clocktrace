import Foundation
import SQLite3

public let biomeRemotePath = NSString(
  string: "~/Library/Biome/streams/restricted/App.InFocus/remote"
).expandingTildeInPath

extension BiomeReads {
  public static let live = BiomeReads.live(remotePath: biomeRemotePath)

  /// The real reads under `remotePath`, one folder per device. Tests point it
  /// at a temp folder; `canOpenSyncDb` and `devicePeers` read the sync
  /// database wherever it is.
  public static func live(remotePath: String) -> BiomeReads {
    BiomeReads(
      canOpenSyncDb: PermissionReads.live.canOpenBiomeSyncDb,
      deviceFolders: {
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: remotePath)
        else { return nil }
        return
          names
          .filter { name in
            !name.hasPrefix(".") && isDirectory(remotePath + "/" + name)
          }
          .sorted()
      },
      segments: { device in
        segmentFiles(in: remotePath + "/" + device)
      },
      segmentData: { device, name in
        FileManager.default.contents(atPath: remotePath + "/" + device + "/" + name)
      },
      devicePeers: livePeers
    )
  }

  private static func livePeers() -> DevicePeerRead {
    var db: OpaquePointer? = nil
    guard
      sqlite3_open_v2(biomeSyncDbPath, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK
    else {
      let message = db.flatMap { String(cString: sqlite3_errmsg($0)) } ?? "cannot open"
      sqlite3_close(db)
      return .failed(message)
    }
    var statement: OpaquePointer? = nil
    guard
      sqlite3_prepare_v2(
        db,
        "SELECT device_identifier, me, name, model, platform, last_sync_date FROM DevicePeer ORDER BY device_identifier",
        -1, &statement, nil
      ) == SQLITE_OK
    else {
      let message = String(cString: sqlite3_errmsg(db))
      sqlite3_close(db)
      return .failed(message)
    }
    var rows: [DevicePeerLine] = []
    while true {
      let step = sqlite3_step(statement)
      if step == SQLITE_DONE { break }
      guard step == SQLITE_ROW else {
        let message = String(cString: sqlite3_errmsg(db))
        sqlite3_finalize(statement)
        sqlite3_close(db)
        return .failed(message)
      }
      func text(_ column: Int32) -> String? {
        guard sqlite3_column_type(statement, column) != SQLITE_NULL else { return nil }
        return String(cString: sqlite3_column_text(statement, column))
      }
      guard let deviceIdentifier = text(0) else { continue }
      rows.append(
        DevicePeerLine(
          deviceIdentifier: deviceIdentifier,
          me: sqlite3_column_int(statement, 1) != 0,
          name: text(2),
          model: text(3),
          platform: sqlite3_column_type(statement, 4) == SQLITE_NULL
            ? nil : Int(sqlite3_column_int64(statement, 4)),
          lastSyncDate: sqlite3_column_type(statement, 5) == SQLITE_NULL
            ? nil : sqlite3_column_double(statement, 5)
        ))
    }
    sqlite3_finalize(statement)
    sqlite3_close(db)
    return .rows(rows)
  }
}

private func isDirectory(_ path: String) -> Bool {
  var isDirectory: ObjCBool = false
  let exists = FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory)
  return exists && isDirectory.boolValue
}

/// The regular files in `folder` with each file's own modification time.
/// Subfolders are skipped: `tombstone/` holds deletion markers, not records.
/// A folder that cannot be listed is `<folder>: <reason>`.
private func segmentFiles(in folder: String) -> SegmentsRead {
  do {
    let names = try FileManager.default.contentsOfDirectory(atPath: folder)
    return .listed(
      names
        .filter { name in
          !name.hasPrefix(".") && !isDirectory(folder + "/" + name)
        }
        .map { name in
          let attributes = try? FileManager.default.attributesOfItem(
            atPath: folder + "/" + name)
          let modifiedAt =
            (attributes?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
          return BiomeSegment(name: name, modifiedAt: modifiedAt)
        }
        .sorted { $0.name < $1.name })
  } catch {
    return .failed("\(folder): \(listingReason(error))")
  }
}

private func listingReason(_ error: Error) -> String {
  guard
    let underlying = (error as NSError).userInfo[NSUnderlyingErrorKey] as? NSError,
    underlying.domain == NSPOSIXErrorDomain
  else { return error.localizedDescription }
  return String(cString: strerror(Int32(underlying.code)))
}
