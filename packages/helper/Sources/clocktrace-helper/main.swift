import Foundation
import HelperCore

switch Command.parse(Array(CommandLine.arguments.dropFirst())) {
case .version:
  print(version)
case .watch:
  runWatch()
case .permissions:
  emit(checkPermissions().json())
  exit(0)
case .requestAccessibility:
  let code = requestAccessibility()
  emit(requestOutcomeLine(exitCode: code))
  exit(code)
case .requestAutomation(let bundleId):
  let code = requestAutomation(bundleId: bundleId)
  emit(requestOutcomeLine(exitCode: code))
  exit(code)
case .requestFullDiskAccess:
  let code = requestFullDiskAccess()
  emit(requestOutcomeLine(exitCode: code))
  exit(code)
case .biomeRecords(let since):
  exit(biomeRecords(since: since))
case .biomeDevices:
  exit(biomeDevices())
case .spawn(let program, let args):
  exit(runSpawn(program: program, args: args))
case .usage:
  FileHandle.standardError.write(usageText.data(using: .utf8)!)
  exit(2)
}
