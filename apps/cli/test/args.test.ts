import { describe, expect, it } from "vitest";

import { commands, parseArgs, usage } from "../src/args.js";

describe("args", () => {
  it("run is not a command", () => {
    // Given: the argv ["run"]
    // When
    const command = parseArgs(["run"]);
    // Then
    expect(command).toBe(null);
  });

  it("the usage line names every command and no Collector command", () => {
    // Given: the exported usage
    // When: read it
    // Then
    expect(usage).toBe(
      "usage: clocktrace (setup | start | stop | status | permissions | mcp | --version)",
    );
  });

  it("each command name parses to itself", () => {
    // Given: commands
    // When
    const parsed = commands.map((c) => parseArgs([c]));
    // Then
    expect(parsed).toEqual([
      "setup",
      "start",
      "stop",
      "status",
      "permissions",
      "mcp",
    ]);
  });

  it("help and version flags parse", () => {
    // Given: the argv ["--help"], ["-h"], ["--version"], ["-v"], []
    // When
    const parsed = ["--help", "-h", "--version", "-v"].map((a) =>
      parseArgs([a]),
    );
    // Then
    expect([...parsed, parseArgs([])]).toEqual([
      "help",
      "help",
      "version",
      "version",
      null,
    ]);
  });
});
