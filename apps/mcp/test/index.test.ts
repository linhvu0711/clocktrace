import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { ready } from "../src/index.js";

describe("mcp", () => {
  it("runs an Effect", () => {
    expect(Effect.runSync(ready)).toBe("mcp ready");
  });
});
