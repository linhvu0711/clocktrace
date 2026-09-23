import { Either, Option } from "effect";
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

  it("adds after the last server with the file's 4-space step", () => {
    // Given: a 4-space file with one other server
    const text =
      "model: nous-1\n\n\nmcp_servers:\n    foo:\n        command: foo   # keep\nz: 0x1F\n";
    // When
    const result = setRegistration(text, server);
    // Then
    expect(result).toEqual(
      Either.right(
        "model: nous-1\n\n\nmcp_servers:\n    foo:\n        command: foo   # keep\n    clocktrace:\n        command: /opt/node\n        args:\n            - /app/main.js\n            - mcp\nz: 0x1F\n",
      ),
    );
  });

  it("keeps CRLF line ends", () => {
    // Given
    const text = "mcp_servers:\r\n  foo:\r\n    command: foo\r\n";
    // When
    const result = setRegistration(text, server);
    // Then
    expect(result).toEqual(
      Either.right(
        "mcp_servers:\r\n  foo:\r\n    command: foo\r\n  clocktrace:\r\n    command: /opt/node\r\n    args:\r\n      - /app/main.js\r\n      - mcp\r\n",
      ),
    );
  });

  it("replaces an existing Registration in place and keeps env", () => {
    // Given: an old Registration with an env map, then another server
    const text =
      "mcp_servers:\n  clocktrace:\n    command: clocktrace\n    args: [mcp]\n    env:\n      CLOCKTRACE_DB: /tmp/x.db\n  foo: {command: foo}\n";
    // When
    const result = setRegistration(text, server);
    // Then
    expect(result).toEqual(
      Either.right(
        `mcp_servers:\n${b2}    env:\n      CLOCKTRACE_DB: /tmp/x.db\n  foo: {command: foo}\n`,
      ),
    );
  });

  it("replaces a one-line Registration as one piece", () => {
    // Given
    const text =
      "mcp_servers:\n  clocktrace: {command: old}\n  foo: {command: foo}\n";
    // When
    const result = setRegistration(text, server);
    // Then
    expect(result).toEqual(
      Either.right(`mcp_servers:\n${b2}  foo: {command: foo}\n`),
    );
  });

  it("mcp_servers: {} becomes a block", () => {
    // Given
    const text = "a: 1\nmcp_servers: {}\nz: 2\n";
    // When
    const result = setRegistration(text, server);
    // Then
    expect(result).toEqual(Either.right(`a: 1\nmcp_servers:\n${b2}z: 2\n`));
  });

  it("an empty mcp_servers value becomes a block", () => {
    // Given
    const text = "mcp_servers:\n";
    // When
    const result = setRegistration(text, server);
    // Then
    expect(result).toEqual(Either.right(`mcp_servers:\n${b2}`));
  });

  it("mcp_servers: ~ keeps its comment", () => {
    // Given
    const text = "mcp_servers: ~ # none\n";
    // When
    const result = setRegistration(text, server);
    // Then
    expect(result).toEqual(Either.right(`mcp_servers: # none\n${b2}`));
  });

  it.each([
    "model: [\n",
    "a: 1\n---\nb: 2\n",
    "- a\n",
    "mcp_servers: text\n",
    "mcp_servers: {foo: {command: foo}}\n",
    "{model: x}\n",
  ])("set stops on bad input: %j", (text) => {
    // Given: text the edit must not touch
    // When
    const result = setRegistration(text, server);
    // Then
    expect(Either.getLeft(result).pipe(Option.map((e) => e._tag))).toEqual(
      Option.some("HermesConfigEditError"),
    );
  });

  it("a result that fails the check stops", () => {
    // Given: a document end marker, so added lines would form a second document
    const text = "a: 1\n...\n";
    // When
    const result = setRegistration(text, server);
    // Then
    expect(Either.isLeft(result)).toBe(true);
  });
});
