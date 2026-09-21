import { describe, expect, it } from "vitest";

import { stateFromPrint } from "../src/launchd.js";

describe("stateFromPrint", () => {
  it("state = running is running", () => {
    // Given: print output with a running state line
    const lines = [
      "com.clocktrace.collector = {",
      "\tactive count = 1",
      "\tstate = running",
      "}",
    ];
    // When
    const state = stateFromPrint(lines);
    // Then
    expect(state).toBe("running");
  });

  it("state = not running is stopped", () => {
    // Given: print output with a not running state line
    const lines = [
      "com.clocktrace.collector = {",
      "\tstate = not running",
      "\tlast exit code = 1",
      "}",
    ];
    // When
    const state = stateFromPrint(lines);
    // Then
    expect(state).toBe("stopped");
  });

  it("no output is stopped", () => {
    // Given: [] (what exit 113 leaves on stdout)
    // When
    const state = stateFromPrint([]);
    // Then
    expect(state).toBe("stopped");
  });
});
