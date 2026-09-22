import Foundation
import HelperCore

switch Command.parse(Array(CommandLine.arguments.dropFirst())) {
case .version:
  print(version)
case .watch:
  runWatch()
case .permissions:
  emit(checkPermissions().json())
case .requestAccessibility:
  exit(requestAccessibility())
case .requestAutomation(let bundleId):
  exit(requestAutomation(bundleId: bundleId))
case .requestFullDiskAccess:
  exit(requestFullDiskAccess())
case .biomeRecords(let since):
  exit(biomeRecords(since: since))
case .biomeDevices:
  exit(biomeDevices())
case .usage:
  FileHandle.standardError.write(usageText.data(using: .utf8)!)
  exit(2)
}
