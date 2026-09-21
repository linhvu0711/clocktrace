import { describe, expect, it } from "vitest";

import { HelperExitedError } from "../src/helper.js";

describe("HelperExitedError", () => {
  it("HelperExitedError names the cause", () => {
    // Given: a Helper that exited non-zero
    const error = new HelperExitedError({
      cause: "permissions request exited 3",
    });
    // When
    const message = error.message;
    // Then
    expect(message).toBe("helper exited: permissions request exited 3");
    expect(message.length).toBeGreaterThan(0);
  });
});
