import Foundation

/// The pids a Screen hold counts for, from `IOPMCopyAssertionsByProcess`: each
/// process that asks macOS to keep the screen on, and the process it asks for
/// (`caffeinate` for One Switch). Chrome's hold says `NoDisplaySleepAssertion`
/// in `AssertType` and `PreventUserIdleDisplaySleep` in `AssertionTrueType`.
func screenHoldPids(_ byProcess: [pid_t: [[String: Any]]]) -> Set<pid_t> {
  var pids: Set<pid_t> = []
  for (pid, holds) in byProcess {
    for hold in holds {
      let type = (hold["AssertionTrueType"] ?? hold["AssertType"]) as? String
      guard
        type == "PreventUserIdleDisplaySleep" || type == "NoDisplaySleepAssertion",
        (hold["AssertLevel"] as? Int ?? 255) != 0
      else { continue }
      pids.insert(pid)
      if let onBehalf = hold["AssertionOnBehalfOfPID"] as? Int {
        pids.insert(pid_t(onBehalf))
      }
    }
  }
  return pids
}
