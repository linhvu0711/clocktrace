import { readFileSync } from "node:fs";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { ready, version } from "../src/index.js";

describe("cli", () => {
  it("runs an Effect", () => {
    expect(Effect.runSync(ready)).toBe("cli ready");
  });

  it("reports the version from package.json", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(version()).toBe(pkg.version);
  });
});
