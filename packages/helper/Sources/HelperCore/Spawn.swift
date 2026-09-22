import Dispatch
import Foundation

public final class Spawn {
  private let child = Process()

  public init(program: String, args: [String]) {
    child.executableURL = URL(fileURLWithPath: program)
    child.arguments = args
  }

  public func start() -> Bool {
    do {
      try child.run()
      return true
    } catch {
      return false
    }
  }

  public func forward(_ sig: Int32) {
    kill(child.processIdentifier, sig)
  }

  public func wait() -> Int32 {
    child.waitUntilExit()
    return child.terminationReason == .uncaughtSignal
      ? 128 + child.terminationStatus : child.terminationStatus
  }
}

public func runSpawn(
  program: String,
  args: [String],
  emitError: @escaping (String) -> Void = HelperCore.emitError
) -> Int32 {
  let spawn = Spawn(program: program, args: args)
  if !spawn.start() {
    emitError("spawn: cannot start \(program)")
    return 127
  }
  var sources: [DispatchSourceSignal] = []
  for sig in [SIGTERM, SIGINT] {
    signal(sig, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: sig, queue: .global())
    source.setEventHandler { spawn.forward(sig) }
    source.resume()
    sources.append(source)
  }
  return spawn.wait()
}
