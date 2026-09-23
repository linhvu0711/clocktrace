import Foundation

public func checkPermissions(
  reads: PermissionReads = .live,
  probeLimit: DispatchTimeInterval = .seconds(5)
) -> Permissions {
  var automation: [String: GrantState] = [:]
  let probe = Probe()
  for bundleId in supportedBrowsers {
    guard reads.installed(bundleId) else {
      automation[bundleId] = .notInstalled
      continue
    }
    guard reads.running(bundleId) else {
      automation[bundleId] = .notRunning
      continue
    }
    guard
      case .value(let status) = probe.run(
        bundleId, within: probeLimit, { reads.automationStatus(bundleId, false) })
    else {
      automation[bundleId] = .noAnswer
      continue
    }
    automation[bundleId] = grantState(status)
  }
  return Permissions(
    accessibility: reads.axTrusted() ? .granted : .denied,
    automation: automation,
    fullDiskAccess: reads.canOpenBiomeSyncDb() ? .granted : .denied
  )
}

public func requestAccessibility(reads: PermissionReads = .live) -> Int32 {
  reads.axPrompt()
  return 0
}

public func requestAutomation(
  bundleId: String,
  reads: PermissionReads = .live,
  emitError: @escaping (String) -> Void = HelperCore.emitError
) -> Int32 {
  guard reads.running(bundleId) else {
    emitError("\(bundleId) is not running, open it and retry")
    return 3
  }
  if reads.automationStatus(bundleId, true) == -600 {
    emitError("\(bundleId) is not running, open it and retry")
    return 3
  }
  return 0
}

public func requestFullDiskAccess(reads: PermissionReads = .live) -> Int32 {
  reads.openSettings(fullDiskAccessSettingsUrl)
  return 0
}

// `open -W` returns 0 whatever the app exits, so the request outcome
// travels as a JSON line on stdout, not as an exit code.
public func requestOutcomeLine(exitCode: Int32) -> String {
  exitCode == 3 ? "{\"outcome\":\"notRunning\"}" : "{\"outcome\":\"asked\"}"
}
