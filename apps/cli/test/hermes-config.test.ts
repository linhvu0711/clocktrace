import { Either } from "effect";
import { describe, expect, it } from "vitest";

import { type HermesServer, setRegistration } from "../src/hermes-config.js";

const server: HermesServer = {
  command: "/opt/node",
  args: ["/app/main.js", "mcp"],
};

// The Registration for `server` at a 2-space step.
const b2 =
  "  clocktrace:\n    command: /opt/node\n    args:\n      - /app/main.js\n      - mcp\n";

describe("setRegistration", () => {
  it("adds mcp_servers at the end and keeps every other byte", () => {
    // Given: a file with no mcp_servers and its own spacing
    const text = "model: nous-1   # note\nother: {command: x}\n";
    // When
    const result = setRegistration(text, server);
    // Then
    expect(result).toEqual(
      Either.right(
        `model: nous-1   # note\nother: {command: x}\nmcp_servers:\n${b2}`,
      ),
    );
  });

  it("a file with no final newline keeps none", () => {
    // Given
    const text = "model: nous-1";
    // When
    const result = setRegistration(text, server);
    // Then
    expect(result).toEqual(
      Either.right(
        "model: nous-1\nmcp_servers:\n  clocktrace:\n    command: /opt/node\n    args:\n      - /app/main.js\n      - mcp",
      ),
    );
  });

  it("an empty file gets the block", () => {
    // Given
    const text = "";
    // When
    const result = setRegistration(text, server);
    // Then
    expect(result).toEqual(Either.right(`mcp_servers:\n${b2}`));
  });

  it("a comment-only file keeps its comment", () => {
    // Given
    const text = "# hermes\n";
    // When
    const result = setRegistration(text, server);
    // Then
    expect(result).toEqual(Either.right(`# hermes\nmcp_servers:\n${b2}`));
  });
});
