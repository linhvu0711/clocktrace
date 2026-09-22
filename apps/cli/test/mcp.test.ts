import { Effect, Exit } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { McpStartupError, startMcp } from "../src/mcp.js";

describe("mcp", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps a startup rejection to a tagged error, not a defect", async () => {
    // Effect.flip turns a tagged failure into the success value; a defect would
    // stay a defect and reject here, so this proves the error is recoverable.
    const error = await Effect.runPromise(
      Effect.flip(startMcp(() => Promise.reject(new Error("port in use")))),
    );
    expect(error).toBeInstanceOf(McpStartupError);
    expect(error.message).toBe(
      "could not start the MCP server: Error: port in use",
    );
  });

  it("prints the serving line to stderr on a clean start, stdout clean", async () => {
    // Given: console spies and a serve that resolves
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // When
    const exit = await Effect.runPromiseExit(startMcp(() => Promise.resolve()));
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(errSpy).toHaveBeenCalledWith("clocktrace mcp: serving on stdio");
    expect(logSpy).not.toHaveBeenCalled();
  });
});
