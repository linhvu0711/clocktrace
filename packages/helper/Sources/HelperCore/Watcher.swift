import AppKit
import Foundation

public final class Poller {
  private let reads: Reads
  private let urls: UrlReader
  private let clock: () -> Date
  private let emit: (String) -> Void
  private var tracker = Tracker()
  private var polling = false
  private var pending = false

  public init(
    reads: Reads,
    urls: UrlReader,
    clock: @escaping () -> Date = Date.init,
    emit: @escaping (String) -> Void
  ) {
    self.reads = reads
    self.urls = urls
    self.clock = clock
    self.emit = emit
  }

  public func poll() {
    if polling {
      pending = true
      return
    }
    polling = true
    defer { polling = false }
    repeat {
      pending = false
      let sample = Sampler.sample(reads, urls: urls, at: clock())
      let now = clock()
      if let line = tracker.observe(sample, at: now) {
        emit(line.json())
      }
    } while pending
  }
}

public func runWatch(
  reads: Reads = .live,
  emit: @escaping (String) -> Void = HelperCore.emit
) -> Never {
  let poller = Poller(reads: reads, urls: UrlReader(reads: reads), emit: emit)

  poller.poll()
  NSWorkspace.shared.notificationCenter.addObserver(
    forName: NSWorkspace.didActivateApplicationNotification,
    object: nil,
    queue: .main
  ) { _ in
    poller.poll()
  }
  RunLoop.main.add(
    Timer(timeInterval: 1, repeats: true) { _ in poller.poll() }, forMode: .default)
  RunLoop.main.run()
  fatalError("run loop exited unexpectedly")
}
