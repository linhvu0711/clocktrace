import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CommandExecutor, FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Effect, Layer, Ref } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { claudeHost } from "../src/claude-host.js";
import { serverEntry, serverNode } from "../src/host.js";
import { type ExecResult, fakeExecutor } from "./mock-executor.js";

const which = "which claude";
const add = `claude mcp add --scope user clocktrace -- ${serverNode} ${serverEntry} mcp`;
const addWithEnv = `claude mcp add --scope user clocktrace -e CLOCKTRACE_DB=/work/db.db -- ${serverNode} ${serverEntry} mcp`;
const restoreOld = "claude mcp add --scope user clocktrace -- clocktrace mcp";
const remove = "claude mcp remove clocktrace --scope user";
const manualAdd = `claude mcp add --scope user clocktrace -- '${serverNode}' '${serverEntry}' 'mcp'`;

// Runs one Host effect on the real file system and a recording executor.
const run = <A>(
  effect: Effect.Effect<
    A,
    never,
    FileSystem.FileSystem | CommandExecutor.CommandExecutor
  >,
  results: Record<string, ExecResult> = {},
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const executor = yield* fakeExecutor(results);
      const value = yield* effect.pipe(
        Effect.provide(Layer.mergeAll(NodeContext.layer, executor.layer)),
      );
      return { value, recorded: yield* Ref.get(executor.recorded) };
    }),
  );

let home: string;

describe("claude host", () => {
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "clocktrace-home-"));
    vi.stubEnv("HOME", home);
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("registers with remove then add", async () => {
    // Given: no ~/.claude.json; the add exits 0
    // When
    const { value, recorded } = await run(claudeHost.register, {
      [add]: { code: 0 },
    });
    // Then
    expect(value).toEqual({ outcome: "registered" });
    expect(recorded).toEqual([remove, add]);
  });

  it("re-registration keeps the prior env map", async () => {
    // Given: ~/.claude.json holds a clocktrace entry with an env map
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({
        mcpServers: {
          clocktrace: {
            type: "stdio",
            command: "clocktrace",
            args: ["mcp"],
            // biome-ignore lint/style/useNamingConvention: the env key is the name
            env: { CLOCKTRACE_DB: "/work/db.db" },
          },
        },
      }),
    );
    // When
    const { value, recorded } = await run(claudeHost.register, {
      [addWithEnv]: { code: 0 },
    });
    // Then: the replacement carries the env the old entry had
    expect(value).toEqual({ outcome: "registered" });
    expect(recorded).toEqual([remove, addWithEnv]);
  });

  it("a failed add puts back the previous claude registration", async () => {
    // Given: ~/.claude.json holds the legacy bare-word entry; the add fails
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({
        mcpServers: {
          clocktrace: { type: "stdio", command: "clocktrace", args: ["mcp"] },
        },
      }),
    );
    // When
    const { value, recorded } = await run(claudeHost.register, {
      [add]: { code: 1, output: "boom" },
      [restoreOld]: { code: 0 },
    });
    // Then: remove, add, restore the old entry
    expect(recorded).toEqual([remove, add, restoreOld]);
    expect(value).toEqual({ outcome: "failed", byHand: manualAdd });
  });

  it("a failed add does not restore a url-based registration", async () => {
    // Given: ~/.claude.json holds an http entry argv cannot rebuild
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({
        mcpServers: {
          clocktrace: { type: "http", url: "https://example.com/mcp" },
        },
      }),
    );
    // When
    const { value, recorded } = await run(claudeHost.register, {
      [add]: { code: 1, output: "boom" },
    });
    // Then: remove then add, and no partial restore of a wrong entry
    expect(recorded).toEqual([remove, add]);
    expect(value).toEqual({ outcome: "failed", byHand: manualAdd });
  });

  it("unregisters with its own command", async () => {
    // Given: claude on PATH; its remove exits 0
    // When
    const { value, recorded } = await run(claudeHost.unregister, {
      [which]: { code: 0 },
      [remove]: { code: 0 },
    });
    // Then
    expect(value).toBe("unregistered");
    expect(recorded).toEqual([which, remove]);
  });

  it("claude without the server exits 1 and is not registered", async () => {
    // Given: claude on PATH; its remove exits 1 with the real message
    // When
    const { value } = await run(claudeHost.unregister, {
      [which]: { code: 0 },
      [remove]: {
        code: 1,
        output: 'No MCP server named "clocktrace" in user scope',
      },
    });
    // Then
    expect(value).toBe("not registered");
  });

  it("a failed remove is failed", async () => {
    // Given: claude on PATH; its remove exits 1 printing boom
    // When
    const { value } = await run(claudeHost.unregister, {
      [which]: { code: 0 },
      [remove]: { code: 1, output: "boom" },
    });
    // Then
    expect(value).toBe("failed");
  });

  it("missing from PATH is no cli and runs no remove", async () => {
    // Given: claude is not on PATH
    // When
    const { value, recorded } = await run(claudeHost.unregister);
    // Then
    expect(value).toBe("no cli");
    expect(recorded).toEqual([which]);
  });

  it("manual commands quote the node and entry paths", () => {
    expect([claudeHost.manualAdd, claudeHost.manualRemove]).toEqual([
      manualAdd,
      remove,
    ]);
  });

  it("detects claude by its binary or its config file", async () => {
    // Given: on PATH with no file; then off PATH with ~/.claude.json;
    // then neither
    const onPath = await run(claudeHost.detect, { [which]: { code: 0 } });
    writeFileSync(join(home, ".claude.json"), "{}");
    const byFile = await run(claudeHost.detect);
    rmSync(join(home, ".claude.json"));
    const neither = await run(claudeHost.detect);
    // Then
    expect([onPath.value, byFile.value, neither.value]).toEqual([
      true,
      true,
      false,
    ]);
  });
});
