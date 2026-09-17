import XCTest

@testable import HelperCore

final class PermissionsTests: XCTestCase {
  private func reads(
    axTrusted: @escaping () -> Bool = { true },
    axPrompt: @escaping () -> Void = {},
    installed: @escaping (String) -> Bool = {
      ["com.apple.Safari", "com.google.Chrome", "com.brave.Browser"].contains($0)
    },
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

  func testFullDiskAccessGrantedWhenTheSyncDbOpens() {
    // Given: the same reads, but sync.db opens
    let reads = reads(canOpenBiomeSyncDb: { true })
    // When
    let state = checkPermissions(reads: reads).fullDiskAccess
    // Then
    XCTAssertEqual(state, .granted)
  }
}
