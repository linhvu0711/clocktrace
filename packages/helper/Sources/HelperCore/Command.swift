public enum Command: Equatable {
  case version
  case watch
  case permissions
  case requestAccessibility
  case requestAutomation(String)
  case requestFullDiskAccess
  case usage

  public static func parse(_ args: [String]) -> Command {
    if args.count == 4 && Array(args.prefix(3)) == ["permissions", "request", "automation"] {
      return .requestAutomation(args[3])
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
    default:
      return .usage
    }
  }
}

public let usageText =
  "usage: clocktrace-helper (--version | watch | permissions | permissions request (accessibility | automation <bundleId> | fulldiskaccess))\n"
