import XCTest

@testable import HelperCore

final class PermissionsTests: XCTestCase {
  private func reads(
    axTrusted: @escaping () -> Bool = { true },
    axPrompt: @escaping () -> Void = {},
    installed: @escaping (String) -> Bool = {
      ["com.apple.Safari", "com.google.Chrome", "com.brave.Browser"].contains($0)
    },
    running: @escaping (String) -> Bool = { _ in true },
    automationStatus: @escaping (String, Bool) -> OSStatus = { bundleId, _ in
      switch bundleId {
      case "com.apple.Safari": return -600
      case "com.google.Chrome": return -1744
      default: return 0
      }
    },
    canOpenBiomeSyncDb: @escaping () -> Bool = { false },
    openSettings: @escaping (String) -> Void = { _ in }
  ) -> PermissionReads {
    PermissionReads(
      axTrusted: axTrusted,
      axPrompt: axPrompt,
      installed: installed,
      running: running,
      automationStatus: automationStatus,
      canOpenBiomeSyncDb: canOpenBiomeSyncDb,
      openSettings: openSettings
    )
  }

  func testPrintsAllThreeGrantsInKeyOrder() {
    // Given: Accessibility granted; Safari not running, Chrome never asked,
    // Brave granted, the rest not installed; sync.db does not open
    let reads = reads()
    // When
    let json = checkPermissions(reads: reads).json()
    // Then
    XCTAssertEqual(
      json,
      "{\"accessibility\":\"granted\",\"automation\":{\"com.apple.Safari\":\"notRunning\",\"com.brave.Browser\":\"granted\",\"com.google.Chrome\":\"notAsked\",\"com.microsoft.edgemac\":\"notInstalled\",\"com.operasoftware.Opera\":\"notInstalled\",\"com.vivaldi.Vivaldi\":\"notInstalled\",\"org.chromium.Chromium\":\"notInstalled\"},\"fullDiskAccess\":\"denied\"}"
    )
  }

  func testAutomationDeniedWhenTheProbeSaysNotPermitted() {
    // Given: the same reads, but Chrome's probe answers -1743
    let reads = reads(automationStatus: { bundleId, _ in
      switch bundleId {
      case "com.apple.Safari": return -600
      case "com.google.Chrome": return -1743
      default: return 0
      }
    })
    // When
    let state = checkPermissions(reads: reads).automation["com.google.Chrome"]
    // Then
    XCTAssertEqual(state, .denied)
  }

  func testAClosedBrowserIsNotRunningWithoutTheProbe() {
    // Given: Safari closed, its probe would answer granted
    let reads = reads(
      running: { $0 != "com.apple.Safari" },
      automationStatus: { _, _ in 0 })
    // When
    let state = checkPermissions(reads: reads).automation["com.apple.Safari"]
    // Then
    XCTAssertEqual(state, .notRunning)
  }

  func testAClosedBrowserIsNeverProbed() {
    // Given: Safari closed; the probe records every call
    var probes: [String] = []
    let reads = reads(
      running: { $0 != "com.apple.Safari" },
      automationStatus: { bundleId, _ in
        probes.append(bundleId)
        return 0
      })
    // When
    _ = checkPermissions(reads: reads)
    // Then
    XCTAssertEqual(probes, ["com.brave.Browser", "com.google.Chrome"])
  }

  private func slowChromeReads() -> PermissionReads {
    reads(automationStatus: { bundleId, _ in
      if bundleId == "com.google.Chrome" {
        Thread.sleep(forTimeInterval: 0.5)
      }
      return bundleId == "com.apple.Safari" ? -600 : 0
    })
  }

  func testAProbeThatNeverAnswersIsNoAnswerAfterTheLimit() {
    // Given: Chrome's probe hangs; Safari closed answers -600, Brave granted
    let reads = slowChromeReads()
    // When
    let state = checkPermissions(reads: reads, probeLimit: .milliseconds(50))
      .automation["com.google.Chrome"]
    // Then
    XCTAssertEqual(state, .noAnswer)
  }

  func testTheOtherBrowsersKeepTheirStateAfterANoAnswer() {
    // Given: the same reads
    let reads = slowChromeReads()
    // When
    let state = checkPermissions(reads: reads, probeLimit: .milliseconds(50))
      .automation["com.brave.Browser"]
    // Then
    XCTAssertEqual(state, .granted)
  }

  func testNoAnswerEncodesAsNoAnswer() {
    // Given: the same reads
    let reads = slowChromeReads()
    // When
    let json = checkPermissions(reads: reads, probeLimit: .milliseconds(50))
      .json()
    // Then
    XCTAssertEqual(
      json,
      "{\"accessibility\":\"granted\",\"automation\":{\"com.apple.Safari\":\"notRunning\",\"com.brave.Browser\":\"granted\",\"com.google.Chrome\":\"noAnswer\",\"com.microsoft.edgemac\":\"notInstalled\",\"com.operasoftware.Opera\":\"notInstalled\",\"com.vivaldi.Vivaldi\":\"notInstalled\",\"org.chromium.Chromium\":\"notInstalled\"},\"fullDiskAccess\":\"denied\"}"
    )
  }

  func testAccessibilityDeniedWhenNotTrusted() {
    // Given: the same reads, but Accessibility is not granted
    let reads = reads(axTrusted: { false })
    // When
    let state = checkPermissions(reads: reads).accessibility
    // Then
    XCTAssertEqual(state, .denied)
  }

  func testBiomeSyncDbPathIsTheImporterFile() {
    // Given: nothing
    // When
    let isImporterFile = biomeSyncDbPath.hasSuffix("/Library/Biome/sync/sync.db")
    // Then
    XCTAssertTrue(isImporterFile)
  }

  func testRequestAccessibilityAsksThePromptOnce() {
    // Given: a fake whose axPrompt appends to prompts
    var prompts: [String] = []
    let reads = reads(axPrompt: { prompts.append("prompt") })
    // When
    _ = requestAccessibility(reads: reads)
    // Then
    XCTAssertEqual(prompts.count, 1)
  }

  func testRequestAutomationProbesTheBrowserWithAsk() {
    // Given: a fake whose automationStatus records (bundleId, ask) pairs
    var probes: [[String]] = []
    let reads = reads(automationStatus: { bundleId, ask in
      probes.append([bundleId, String(ask)])
      return 0
    })
    // When
    _ = requestAutomation(
      bundleId: "com.apple.Safari", reads: reads, emitError: { _ in })
    // Then
    XCTAssertEqual(probes, [["com.apple.Safari", "true"]])
  }

  func testRequestAutomationExits3WithoutTheProbeWhenNotRunning() {
    // Given: the browser is not running; the probe would answer granted
    let reads = reads(
      running: { _ in false },
      automationStatus: { _, _ in 0 })
    // When
    let code = requestAutomation(
      bundleId: "com.apple.Safari", reads: reads, emitError: { _ in })
    // Then
    XCTAssertEqual(code, 3)
  }

  func testRequestAutomationNeverProbesAClosedBrowser() {
    // Given: the browser is not running; the probe records (bundleId, ask)
    var probes: [[String]] = []
    let reads = reads(
      running: { _ in false },
      automationStatus: { bundleId, ask in
        probes.append([bundleId, String(ask)])
        return 0
      })
    // When
    _ = requestAutomation(
      bundleId: "com.apple.Safari", reads: reads, emitError: { _ in })
    // Then
    XCTAssertEqual(probes, [])
  }

  func testRequestAutomationWaitsForASlowAnswer() {
    // Given: a running browser whose probe takes 0.3 s to answer denied
    let reads = reads(automationStatus: { _, _ in
      Thread.sleep(forTimeInterval: 0.3)
      return -1743
    })
    // When
    let code = requestAutomation(
      bundleId: "com.apple.Safari", reads: reads, emitError: { _ in })
    // Then
    XCTAssertEqual(code, 0)
  }

  func testRequestAutomationExits3WhenNotRunning() {
    // Given: a fake whose automationStatus returns -600
    let reads = reads(automationStatus: { _, _ in -600 })
    // When
    let code = requestAutomation(
      bundleId: "com.apple.Safari", reads: reads, emitError: { _ in })
    // Then
    XCTAssertEqual(code, 3)
  }

  func testRequestAutomationPrintsTheRetryLineWhenNotRunning() {
    // Given: a fake whose automationStatus returns -600; emitError records
    var lines: [String] = []
    let reads = reads(automationStatus: { _, _ in -600 })
    // When
    _ = requestAutomation(
      bundleId: "com.apple.Safari", reads: reads, emitError: { lines.append($0) })
    // Then
    XCTAssertEqual(lines, ["com.apple.Safari is not running, open it and retry"])
  }

  func testRequestAutomationExits0WhenTheBrowserAnswered() {
    // Given: a fake whose automationStatus returns -1743 (user denied)
    let reads = reads(automationStatus: { _, _ in -1743 })
    // When
    let code = requestAutomation(
      bundleId: "com.apple.Safari", reads: reads, emitError: { _ in })
    // Then
    XCTAssertEqual(code, 0)
  }

  func testRequestFullDiskAccessOpensThePane() {
    // Given: a fake whose openSettings records the URL strings
    var urls: [String] = []
    let reads = reads(openSettings: { urls.append($0) })
    // When
    _ = requestFullDiskAccess(reads: reads)
    // Then
    XCTAssertEqual(
      urls,
      ["x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"])
  }

  func testOutcomeLineForExit0() {
    // Given: exit code 0
    // When
    let line = requestOutcomeLine(exitCode: 0)
    // Then
    XCTAssertEqual(line, "{\"outcome\":\"asked\"}")
  }

  func testOutcomeLineForExit3() {
    // Given: exit code 3
    // When
    let line = requestOutcomeLine(exitCode: 3)
    // Then
    XCTAssertEqual(line, "{\"outcome\":\"notRunning\"}")
  }

  func testFullDiskAccessGrantedWhenTheSyncDbOpens() {
    // Given: the same reads, but sync.db opens
    let reads = reads(canOpenBiomeSyncDb: { true })
    // When
    let state = checkPermissions(reads: reads).fullDiskAccess
    // Then
    XCTAssertEqual(state, .granted)
  }

  func testPermissionsAnswersMatchTheSharedFile() {
    // Given: the default reads, then Chrome's probe hanging past the limit,
    // and the shared file the TS tests decode
    let expectedUrl = Bundle.module.url(
      forResource: "permissions.expected", withExtension: "jsonl", subdirectory: "Fixtures")!
    let expected = try! String(contentsOf: expectedUrl, encoding: .utf8)
    // When
    let actual =
      [
        checkPermissions(reads: reads()).json(),
        checkPermissions(reads: slowChromeReads(), probeLimit: .milliseconds(50)).json(),
      ].joined(separator: "\n") + "\n"
    // Then
    XCTAssertEqual(actual, expected)
  }
}
