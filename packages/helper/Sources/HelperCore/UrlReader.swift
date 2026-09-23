import Foundation

public final class UrlReader {
  private let reads: Reads
  private let checkLimit: DispatchTimeInterval
  private let readLimit: DispatchTimeInterval
  private let retryAfter: TimeInterval
  private let log: (String) -> Void
  private let checks = Probe()
  private let urlReads = Probe(queue: DispatchQueue(label: "clocktrace.url-read"))

  private struct State {
    var nextCheck = Date.distantPast
    var logged = false
    var asking = false
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
      if state == .notAsked {
        startAsk(bundleId: bundleId)
      }
      return .missing(state)
    }
    return readUrl(bundleId: bundleId, script: script)
  }

  private func startAsk(bundleId: String) {
    lock.lock()
    var state = states[bundleId] ?? State()
    if state.asking {
      lock.unlock()
      return
    }
    state.asking = true
    states[bundleId] = state
    lock.unlock()

    DispatchQueue.global().async {
      _ = self.reads.automationStatus(bundleId, true)
      self.lock.lock()
      var s = self.states[bundleId] ?? State()
      s.asking = false
      self.states[bundleId] = s
      self.lock.unlock()
    }
  }

  private func check(bundleId: String, at now: Date) -> OSStatus? {
    lock.lock()
    let waiting = (states[bundleId] ?? State()).nextCheck > now
    lock.unlock()
    if waiting {
      return nil
    }

    let answer = checks.run(bundleId, within: checkLimit) {
      self.reads.automationStatus(bundleId, false)
    }
    switch answer {
    case .busy:
      return nil
    case .timedOut:
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
    case .value(let status):
      lock.lock()
      if var s = states[bundleId] {
        s.logged = false
        states[bundleId] = s
      }
      lock.unlock()
      return status
    }
  }

  private func readUrl(bundleId: String, script: String) -> UrlRead {
    let answer = urlReads.run(bundleId, within: readLimit) { self.reads.runScript(script) }
    switch answer {
    case .value(let url):
      return .granted(url)
    case .busy, .timedOut:
      return .granted(nil)
    }
  }
}
