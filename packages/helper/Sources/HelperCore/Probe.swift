import Foundation

enum ProbeAnswer<Value> {
  case value(Value)
  case timedOut
  case busy
}

extension ProbeAnswer: Equatable where Value: Equatable {}

/// Runs work beside the Watcher, one at a time per key, and waits at most a
/// time limit for it. A late answer is dropped: the work still ends and frees
/// its key, but nothing reads what it returned.
final class Probe {
  private let queue: DispatchQueue
  private var running: Set<String> = []
  private let lock = NSLock()

  init(queue: DispatchQueue = .global()) {
    self.queue = queue
  }

  func run<Value>(
    _ key: String,
    within limit: DispatchTimeInterval,
    _ work: @escaping () -> Value
  ) -> ProbeAnswer<Value> {
    lock.lock()
    if running.contains(key) {
      lock.unlock()
      return .busy
    }
    running.insert(key)
    lock.unlock()

    let semaphore = DispatchSemaphore(value: 0)
    var answer: Value?
    queue.async {
      let value = work()
      self.lock.lock()
      self.running.remove(key)
      self.lock.unlock()
      answer = value
      semaphore.signal()
    }
    guard semaphore.wait(timeout: .now() + limit) == .success, let answer else {
      return .timedOut
    }
    return .value(answer)
  }
}
