import Foundation
import HelperCore

switch Command.parse(Array(CommandLine.arguments.dropFirst())) {
case .version:
  print(version)
case .watch:
  runWatch()
case .permissions:
  emit(checkPermissions().json())
case .requestAccessibility, .requestAutomation, .requestFullDiskAccess,
  .usage:
  FileHandle.standardError.write(usageText.data(using: .utf8)!)
  exit(2)
}
