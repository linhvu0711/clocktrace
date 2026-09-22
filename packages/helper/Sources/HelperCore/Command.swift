public enum Command: Equatable {
  case version
  case watch
  case permissions
  case requestAccessibility
  case requestAutomation(String)
  case requestFullDiskAccess
  case biomeRecords(since: Int?)
  case biomeDevices
  case usage

  public static func parse(_ args: [String]) -> Command {
    if args.count == 4 && Array(args.prefix(3)) == ["permissions", "request", "automation"] {
      return .requestAutomation(args[3])
    }
    if args.count == 4 && Array(args.prefix(3)) == ["biome", "records", "--since"],
      let since = Int(args[3])
    {
      return .biomeRecords(since: since)
    }
    switch args {
    case ["--version"]:
      return .version
    case ["watch"]:
      return .watch
    case ["permissions"]:
      return .permissions
    case ["permissions", "request", "accessibility"]:
      return .requestAccessibility
    case ["permissions", "request", "fulldiskaccess"]:
      return .requestFullDiskAccess
    case ["biome", "records"]:
      return .biomeRecords(since: nil)
    case ["biome", "devices"]:
      return .biomeDevices
    default:
      return .usage
    }
  }
}

public let usageText =
  "usage: clocktrace-helper (--version | watch | permissions | permissions request (accessibility | automation <bundleId> | fulldiskaccess) | biome records [--since <unixSeconds>] | biome devices)\n"
