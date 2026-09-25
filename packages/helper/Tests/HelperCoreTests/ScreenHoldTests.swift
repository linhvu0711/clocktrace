import XCTest

@testable import HelperCore

final class ScreenHoldTests: XCTestCase {
  func testTheHoldersOwnPidCounts() {
    // Given: Chrome's video hold, under the old type name
    let byProcess: [pid_t: [[String: Any]]] = [
      5390: [
        [
          "AssertType": "NoDisplaySleepAssertion",
          "AssertionTrueType": "PreventUserIdleDisplaySleep",
          "AssertLevel": 255,
          "AssertName": "Video Wake Lock",
        ]
      ]
    ]
    // When
    let pids = screenHoldPids(byProcess)
    // Then
    XCTAssertEqual(pids, [5390])
  }

  func testAHoldCountsForTheProcessItIsMadeFor() {
    // Given: caffeinate holding the screen on for One Switch
    let byProcess: [pid_t: [[String: Any]]] = [
      4398: [
        [
          "AssertType": "PreventUserIdleDisplaySleep",
          "AssertionTrueType": "PreventUserIdleDisplaySleep",
          "AssertLevel": 255,
          "AssertionOnBehalfOfPID": 2739,
        ]
      ]
    ]
    // When
    let pids = screenHoldPids(byProcess)
    // Then
    XCTAssertEqual(pids, [4398, 2739])
  }

  func testOtherHoldsDoNotCount() {
    // Given: a system-sleep hold, powerd's own display hold, and a hold at level 0
    let byProcess: [pid_t: [[String: Any]]] = [
      2223: [
        [
          "AssertType": "PreventUserIdleSystemSleep",
          "AssertionTrueType": "PreventUserIdleSystemSleep",
          "AssertLevel": 255,
        ]
      ],
      580: [
        [
          "AssertType": "InternalPreventDisplaySleep",
          "AssertionTrueType": "InternalPreventDisplaySleep",
          "AssertLevel": 255,
        ]
      ],
      77: [
        [
          "AssertType": "PreventUserIdleDisplaySleep",
          "AssertionTrueType": "PreventUserIdleDisplaySleep",
          "AssertLevel": 0,
        ]
      ],
    ]
    // When
    let pids = screenHoldPids(byProcess)
    // Then
    XCTAssertEqual(pids, [])
  }
}
