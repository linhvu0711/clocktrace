import XCTest

@testable import HelperCore

final class SamplerTests: XCTestCase {
  private let safari = FrontApp(
    name: "Safari", bundleId: "com.apple.Safari", pid: 3)
  private let textEdit = FrontApp(
    name: "TextEdit", bundleId: "com.apple.TextEdit", pid: 2)

  func testRunsTheScriptWhenAutomationIsGranted() {
    // Given: Reads for a Safari frontmost with Automation granted
    var scripts: [String] = []
    let reads = Reads(
      frontmost: { self.safari },
      axTrusted: { true },
      focusedTitle: { _ in "Example Domain" },
      automationGranted: { _ in true },
      runScript: { script in
        scripts.append(script)
        return "https://example.com/"
      },
      idleSeconds: { 1 }
    )
    // When
    let sample = Sampler.sample(reads)
    // Then
    XCTAssertEqual(
      sample,
      Sample(
        front: safari, axTrusted: true, title: "Example Domain",
        url: .granted("https://example.com/"), idleSeconds: 1))
    XCTAssertEqual(
      scripts,
      ["tell application \"Safari\" to get URL of current tab of front window"])
  }

  func testDoesNotRunTheScriptWhenAutomationIsNotGranted() {
    // Given: the same Reads with Automation denied
    var scripts: [String] = []
    let reads = Reads(
      frontmost: { self.safari },
      axTrusted: { true },
      focusedTitle: { _ in "Example Domain" },
      automationGranted: { _ in false },
      runScript: { script in
        scripts.append(script)
        return "https://example.com/"
      },
      idleSeconds: { 1 }
    )
    // When
    let sample = Sampler.sample(reads)
    // Then
    XCTAssertEqual(sample.url, .missing)
    XCTAssertEqual(scripts, [])
  }

  func testAsksNothingForANonBrowser() {
    // Given: Reads for a non-browser frontmost; everything records calls
    var automationCalls: [String] = []
    var scripts: [String] = []
    let reads = Reads(
      frontmost: { self.textEdit },
      axTrusted: { true },
      focusedTitle: { _ in "Untitled" },
      automationGranted: { id in
        automationCalls.append(id)
        return true
      },
      runScript: { script in
        scripts.append(script)
        return nil
      },
      idleSeconds: { 1 }
    )
    // When
    let sample = Sampler.sample(reads)
    // Then
    XCTAssertEqual(sample.url, .notBrowser)
    XCTAssertEqual(automationCalls, [])
    XCTAssertEqual(scripts, [])
  }

  func testTitleNilWhenNotTrusted() {
    // Given: the TextEdit Reads with Accessibility not granted
    var titleCalls: [pid_t] = []
    let reads = Reads(
      frontmost: { self.textEdit },
      axTrusted: { false },
      focusedTitle: { pid in
        titleCalls.append(pid)
        return "Untitled"
      },
      automationGranted: { _ in true },
      runScript: { _ in nil },
      idleSeconds: { 1 }
    )
    // When
    let sample = Sampler.sample(reads)
    // Then
    XCTAssertNil(sample.title)
    XCTAssertFalse(sample.axTrusted)
    XCTAssertEqual(titleCalls, [])
  }
}
