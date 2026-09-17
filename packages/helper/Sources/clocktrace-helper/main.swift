import Foundation
import HelperCore

switch Command.parse(Array(CommandLine.arguments.dropFirst())) {
case .version:
  print(version)
case .watch:
  exit(0)
case .usage:
  FileHandle.standardError.write(usageText.data(using: .utf8)!)
  exit(2)
}
