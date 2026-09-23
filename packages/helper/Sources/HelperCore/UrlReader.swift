import Foundation

public final class UrlReader {
  private let reads: Reads
  private let checkLimit: DispatchTimeInterval
  private let readLimit: DispatchTimeInterval
  private let retryAfter: TimeInterval
  private let log: (String) -> Void
  private let readQueue = DispatchQueue(label: "clocktrace.url-read")

  private struct State {
    var checkRunning = false
    var nextCheck = Date.distantPast
    var logged = false
    var readRunning = false
  }
  private var states: [String: State] = [:]
  private let lock = NSLock()

  public init(
    reads: Reads,
    checkLimit: DispatchTimeInterval = .seconds(2),
    readLimit: DispatchTimeInterval = .seconds(2),
    retryAfter: TimeInterval = 30,
    log: @escaping (String) -> Void = HelperCore.emitError
  ) {
    self.reads = reads
    self.checkLimit = checkLimit
    self.readLimit = readLimit
    self.retryAfter = retryAfter
    self.log = log
  }

  public func read(bundleId: String, script: String, at now: Date) -> UrlRead {
    guard let status = check(bundleId: bundleId, at: now) else {
      return .missing(.noAnswer)
    }
    let state = grantState(status)
    guard state == .granted else {
      return .missing(state)
    }
    return readUrl(bundleId: bundleId, script: script)
  }

  private func check(bundleId: String, at now: Date) -> OSStatus? {
    lock.lock()
    var state = states[bundleId] ?? State()
    if state.checkRunning || state.nextCheck > now {
      lock.unlock()
      return nil
    }
    state.checkRunning = true
    states[bundleId] = state
    lock.unlock()

    let semaphore = DispatchSemaphore(value: 0)
    var answer: OSStatus?
    DispatchQueue.global().async {
      let status = self.reads.automationStatus(bundleId, false)
      self.lock.lock()
      var s = self.states[bundleId] ?? State()
      s.checkRunning = false
      self.states[bundleId] = s
      self.lock.unlock()
      answer = status
      semaphore.signal()
    }
    if semaphore.wait(timeout: .now() + checkLimit) == .timedOut {
      lock.lock()
      var s = states[bundleId] ?? State()
      s.nextCheck = now.addingTimeInterval(retryAfter)
      let firstTimeout = !s.logged
      s.logged = true
      states[bundleId] = s
      lock.unlock()
      if firstTimeout {
        log(
          "\(bundleId) did not answer the Grant check, trying again every 30 s")
      }
      return nil
    }
    lock.lock()
    if var s = states[bundleId] {
      s.logged = false
      states[bundleId] = s
    }
    lock.unlock()
    return answer
  }

  private func readUrl(bundleId: String, script: String) -> UrlRead {
    lock.lock()
    var state = states[bundleId] ?? State()
    if state.readRunning {
      lock.unlock()
      return .granted(nil)
    }
    state.readRunning = true
    states[bundleId] = state
    lock.unlock()

    let semaphore = DispatchSemaphore(value: 0)
    var url: String?
    readQueue.async {
      url = self.reads.runScript(script)
      self.lock.lock()
      var s = self.states[bundleId] ?? State()
      s.readRunning = false
      self.states[bundleId] = s
      self.lock.unlock()
      semaphore.signal()
    }
    if semaphore.wait(timeout: .now() + readLimit) == .timedOut {
      return .granted(nil)
    }
    return .granted(url)
  }
}
