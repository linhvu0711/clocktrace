import AppKit
import Foundation

public func runWatch(
  reads: Reads = .live,
  emit: @escaping (String) -> Void = HelperCore.emit
) -> Never {
  var tracker = Tracker()
  func poll() {
    if let line = tracker.observe(Sampler.sample(reads), at: Date()) {
      emit(line.json())
    }
  }

  poll()
  NSWorkspace.shared.notificationCenter.addObserver(
    forName: NSWorkspace.didActivateApplicationNotification,
    object: nil,
    queue: .main
  ) { _ in
    poll()
  }
  RunLoop.main.add(
    Timer(timeInterval: 1, repeats: true) { _ in poll() }, forMode: .default)
  RunLoop.main.run()
  fatalError("run loop exited unexpectedly")
}
