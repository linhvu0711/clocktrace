import Foundation

public func emit(_ line: String) {
  guard let data = (line + "\n").data(using: .utf8) else { return }
  FileHandle.standardOutput.write(data)
}

public func emitError(_ line: String) {
  guard let data = (line + "\n").data(using: .utf8) else { return }
  FileHandle.standardError.write(data)
}
