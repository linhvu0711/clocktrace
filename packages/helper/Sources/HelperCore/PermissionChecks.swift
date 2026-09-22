import Foundation

public func checkPermissions(
  reads: PermissionReads = .live,
  probeLimit: DispatchTimeInterval = .seconds(5)
) -> Permissions {
  var automation: [String: GrantState] = [:]
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
      let status = answerWithin(
        probeLimit, { reads.automationStatus(bundleId, false) })
    else {
      automation[bundleId] = .noAnswer
      continue
    }
    switch status {
    case 0:
      automation[bundleId] = .granted
    case -1744:
      automation[bundleId] = .notAsked
    case -600:
      automation[bundleId] = .notRunning
    default:
      automation[bundleId] = .denied
    }
  }
  return Permissions(
    accessibility: reads.axTrusted() ? .granted : .denied,
    automation: automation,
    fullDiskAccess: reads.canOpenBiomeSyncDb() ? .granted : .denied
  )
}

private func answerWithin(
  _ limit: DispatchTimeInterval,
  _ probe: @escaping () -> OSStatus
) -> OSStatus? {
  let semaphore = DispatchSemaphore(value: 0)
  var answer: OSStatus?
  DispatchQueue.global().async {
    answer = probe()
    semaphore.signal()
  }
  if semaphore.wait(timeout: .now() + limit) == .timedOut {
    return nil
  }
  return answer
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
