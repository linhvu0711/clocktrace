import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { ready } from "../src/index.js";

describe("core", () => {
  it("runs an Effect", () => {
    expect(Effect.runSync(ready)).toBe("core ready");
  });
});
