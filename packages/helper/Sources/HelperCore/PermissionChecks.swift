public func checkPermissions(reads: PermissionReads = .live) -> Permissions {
  var automation: [String: GrantState] = [:]
  for bundleId in supportedBrowsers {
    guard reads.installed(bundleId) else {
      automation[bundleId] = .notInstalled
      continue
    }
    switch reads.automationStatus(bundleId, false) {
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
