public enum Command: Equatable {
  case version
  case watch
  case usage

  public static func parse(_ args: [String]) -> Command {
    switch args {
    case ["--version"]:
      return .version
    case ["watch"]:
      return .watch
    default:
      return .usage
    }
  }
}

public let usageText = "usage: clocktrace-helper (--version | watch)\n"
