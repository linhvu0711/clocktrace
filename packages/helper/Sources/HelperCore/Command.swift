public enum Command: Equatable {
  case version
  case watch
  case permissions
  case requestAccessibility
  case requestAutomation(String)
  case requestFullDiskAccess
  case biomeRecords(from: [String: String])
  case biomeDevices
  case spawn(program: String, args: [String])
  case usage

  public static func parse(_ args: [String]) -> Command {
    if args.count >= 2 && args[0] == "spawn" {
      return .spawn(program: args[1], args: Array(args.dropFirst(2)))
    }
    if args.count == 4 && Array(args.prefix(3)) == ["permissions", "request", "automation"] {
      return .requestAutomation(args[3])
    }
    if args.first == "biome" && args.dropFirst().first == "records" {
      var from: [String: String] = [:]
      var rest = args.dropFirst(2)
      while !rest.isEmpty {
        guard rest.count >= 2, rest.first == "--from" else { return .usage }
        let pair = rest.dropFirst().first ?? ""
        rest = rest.dropFirst(2)
        guard let eq = pair.firstIndex(of: "=") else { return .usage }
        let device = String(pair[pair.startIndex..<eq])
        let segment = String(pair[pair.index(after: eq)...])
        guard !device.isEmpty, !segment.isEmpty, from[device] == nil else {
          return .usage
        }
        from[device] = segment
      }
      return .biomeRecords(from: from)
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
    case ["biome", "devices"]:
      return .biomeDevices
    default:
      return .usage
    }
  }
}

public let usageText =
  "usage: clocktrace-helper (--version | watch | permissions | permissions request (accessibility | automation <bundleId> | fulldiskaccess) | biome records [--from <deviceId>=<segment>]... | biome devices | spawn <program> [args...])\n"
