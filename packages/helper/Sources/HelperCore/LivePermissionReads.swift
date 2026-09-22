import AppKit
import ApplicationServices
import Foundation

public let biomeSyncDbPath = NSString(string: "~/Library/Biome/sync/sync.db")
  .expandingTildeInPath
public let fullDiskAccessSettingsUrl =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"

extension PermissionReads {
  public static let live = PermissionReads(
    axTrusted: Reads.live.axTrusted,
    axPrompt: {
      let options =
        [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true]
        as CFDictionary
      _ = AXIsProcessTrustedWithOptions(options)
      Thread.sleep(forTimeInterval: 1)
    },
    installed: { bundleId in
      NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) != nil
    },
    running: { bundleId in
      !NSRunningApplication.runningApplications(withBundleIdentifier: bundleId)
        .isEmpty
    },
    automationStatus: { bundleId, ask in
      HelperCore.automationStatus(bundleId: bundleId, askUser: ask)
    },
    canOpenBiomeSyncDb: {
      let fd = open(biomeSyncDbPath, O_RDONLY)
      guard fd >= 0 else { return false }
      close(fd)
      return true
    },
    openSettings: { string in
      if let url = URL(string: string) {
        NSWorkspace.shared.open(url)
      }
    }
  )
}
