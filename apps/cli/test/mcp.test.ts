import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { McpStartupError, startMcp } from "../src/mcp.js";

describe("mcp", () => {
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

  it("succeeds when the server starts cleanly", async () => {
    await expect(
      Effect.runPromise(startMcp(() => Promise.resolve())),
    ).resolves.toBeUndefined();
  });
});
