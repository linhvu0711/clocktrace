import XCTest

@testable import HelperCore

final class SpawnTests: XCTestCase {
  func testExitsWithTheChildsCode() {
    // Given: a child that exits 7, started
    let spawn = Spawn(program: "/bin/sh", args: ["-c", "exit 7"])
    XCTAssertTrue(spawn.start())
    // When
    let code = spawn.wait()
    // Then
    XCTAssertEqual(code, 7)
  }

  func testForwardsSigtermToTheChild() {
    // Given: a shell that exits 9 on TERM, started
    let spawn = Spawn(
      program: "/bin/sh",
      args: ["-c", "trap 'exit 9' TERM; while :; do sleep 0.1; done"])
    XCTAssertTrue(spawn.start())
    Thread.sleep(forTimeInterval: 0.3)
    // When
    spawn.forward(SIGTERM)
    let code = spawn.wait()
    // Then
    XCTAssertEqual(code, 9)
  }

  func testForwardsSigintToTheChild() {
    // Given: a shell that exits 8 on INT, started
    let spawn = Spawn(
      program: "/bin/sh",
      args: ["-c", "trap 'exit 8' INT; while :; do sleep 0.1; done"])
    XCTAssertTrue(spawn.start())
    Thread.sleep(forTimeInterval: 0.3)
    // When
    spawn.forward(SIGINT)
    let code = spawn.wait()
    // Then
    XCTAssertEqual(code, 8)
  }

  func testAnUncaughtSignalIs128PlusTheSignal() {
    // Given: a child that cannot catch KILL, started
    let spawn = Spawn(program: "/bin/sleep", args: ["30"])
    XCTAssertTrue(spawn.start())
    Thread.sleep(forTimeInterval: 0.2)
    // When
    spawn.forward(SIGKILL)
    let code = spawn.wait()
    // Then
    XCTAssertEqual(code, 137)
  }

  func testAMissingProgramDoesNotStart() {
    // Given: a program that does not exist; emitError records
    var lines: [String] = []
    // When
    let code = runSpawn(
      program: "/nope/bin", args: [], emitError: { lines.append($0) })
    // Then
    XCTAssertEqual(code, 127)
    XCTAssertEqual(lines, ["spawn: cannot start /nope/bin"])
  }
}
