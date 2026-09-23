import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CommandExecutor, FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Effect, Layer, Ref } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { codexHost } from "../src/codex-host.js";
import { serverEntry, serverNode } from "../src/host.js";
import { type ExecResult, fakeExecutor } from "./mock-executor.js";

const which = "which codex";
const add = `codex mcp add clocktrace -- ${serverNode} ${serverEntry} mcp`;
const addWithEnv = `codex mcp add clocktrace --env CLOCKTRACE_DB=/work/db.db -- ${serverNode} ${serverEntry} mcp`;
const restoreOld = "codex mcp add clocktrace -- /old/node /old/entry.js mcp";
const restoreOldWithEnv =
  "codex mcp add clocktrace --env CLOCKTRACE_DB=/work/db.db -- clocktrace mcp";
const remove = "codex mcp remove clocktrace";
const manualAdd = `codex mcp add clocktrace -- '${serverNode}' '${serverEntry}' 'mcp'`;
const manualAddWithEnv = `codex mcp add clocktrace --env 'CLOCKTRACE_DB=/work/db.db' -- '${serverNode}' '${serverEntry}' 'mcp'`;

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

describe("codex host", () => {
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "clocktrace-home-"));
    vi.stubEnv("HOME", home);
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  const writeConfig = (text: string) => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(join(home, ".codex", "config.toml"), text);
  };

  it("registers with remove then add", async () => {
    // Given: no config.toml; the add exits 0
    // When
    const { value, recorded } = await run(codexHost.register, {
      [add]: { code: 0 },
    });
    // Then
    expect(value).toEqual({ outcome: "registered" });
    expect(recorded).toEqual([remove, add]);
  });

  it("re-registration keeps an inline env table", async () => {
    // Given: config.toml holds the env as an inline table
    writeConfig(
      '[mcp_servers.clocktrace]\ncommand = "clocktrace"\nargs = ["mcp"]\nenv = { CLOCKTRACE_DB = "/work/db.db" }\n',
    );
    // When
    const { value, recorded } = await run(codexHost.register, {
      [addWithEnv]: { code: 0 },
    });
    // Then: the replacement carries the env the old entry had
    expect(value).toEqual({ outcome: "registered" });
    expect(recorded).toEqual([remove, addWithEnv]);
  });

  it("re-registration keeps the prior env map", async () => {
    // Given: config.toml holds a clocktrace entry with an env sub-table
    writeConfig(
      '[mcp_servers.clocktrace]\ncommand = "clocktrace"\nargs = ["mcp"]\n\n[mcp_servers.clocktrace.env]\nCLOCKTRACE_DB = "/work/db.db"\n',
    );
    // When
    const { value, recorded } = await run(codexHost.register, {
      [addWithEnv]: { code: 0 },
    });
    // Then: the replacement carries the env the old entry had
    expect(recorded).toEqual([remove, addWithEnv]);
    expect(value).toEqual({ outcome: "registered" });
  });

  it("a failed add shows the manual command", async () => {
    // Given: codex exits 1 printing "boom", and no prior registration
    // When
    const { value, recorded } = await run(codexHost.register, {
      [add]: { code: 1, output: "boom" },
    });
    // Then: remove then add, nothing more to put back
    expect(recorded).toEqual([remove, add]);
    expect(value).toEqual({ outcome: "failed", byHand: manualAdd });
  });

  it("a failed add puts back the previous codex registration", async () => {
    // Given: config.toml holds a stale [mcp_servers.clocktrace] table
    writeConfig(
      '[mcp_servers.clocktrace]\ncommand = "/old/node"\nargs = ["/old/entry.js", "mcp"]\n',
    );
    // When
    const { value, recorded } = await run(codexHost.register, {
      [add]: { code: 1, output: "boom" },
      [restoreOld]: { code: 0 },
    });
    // Then
    expect(recorded).toEqual([remove, add, restoreOld]);
    expect(value).toEqual({ outcome: "failed", byHand: manualAdd });
  });

  it("a failed add restores the prior env map too", async () => {
    // Given: config.toml holds an entry with an [mcp_servers.clocktrace.env]
    writeConfig(
      '[mcp_servers.clocktrace]\ncommand = "clocktrace"\nargs = ["mcp"]\n\n[mcp_servers.clocktrace.env]\nCLOCKTRACE_DB = "/work/db.db"\n',
    );
    // When
    const { value, recorded } = await run(codexHost.register, {
      [addWithEnv]: { code: 1, output: "boom" },
      [restoreOldWithEnv]: { code: 0 },
    });
    // Then
    expect(recorded).toEqual([remove, addWithEnv, restoreOldWithEnv]);
    // And the by-hand command keeps the env too
    expect(value).toEqual({ outcome: "failed", byHand: manualAddWithEnv });
  });

  it("a config.toml that does not parse restores nothing", async () => {
    // Given: config.toml has an unclosed table header; the add fails
    writeConfig('[mcp_servers.clocktrace\ncommand = "/old/node"\n');
    // When
    const { value, recorded } = await run(codexHost.register, {
      [add]: { code: 1, output: "boom" },
    });
    // Then
    expect(recorded).toEqual([remove, add]);
    expect(value).toEqual({ outcome: "failed", byHand: manualAdd });
  });

  it("unregisters with its own command", async () => {
    // Given: codex on PATH; its remove exits 0
    // When
    const { value, recorded } = await run(codexHost.unregister, {
      [which]: { code: 0 },
      [remove]: { code: 0 },
    });
    // Then
    expect(value).toBe("unregistered");
    expect(recorded).toEqual([which, remove]);
  });

  it("codex without the server exits 0 and is still not registered", async () => {
    // Given: codex on PATH; its remove exits 0 with the real message
    // When
    const { value } = await run(codexHost.unregister, {
      [which]: { code: 0 },
      [remove]: { code: 0, output: "No MCP server named 'clocktrace' found." },
    });
    // Then
    expect(value).toBe("not registered");
  });

  it("a failed remove is failed", async () => {
    // Given: codex on PATH; its remove exits 1 printing boom
    // When
    const { value } = await run(codexHost.unregister, {
      [which]: { code: 0 },
      [remove]: { code: 1, output: "boom" },
    });
    // Then
    expect(value).toBe("failed");
  });

  it("a host binary missing from PATH is no cli and runs no remove", async () => {
    // Given: codex is not on PATH
    // When
    const { value, recorded } = await run(codexHost.unregister);
    // Then
    expect(value).toBe("no cli");
    expect(recorded).toEqual([which]);
  });

  it("manual commands quote the node and entry paths", () => {
    expect([codexHost.manualAdd, codexHost.manualRemove]).toEqual([
      manualAdd,
      remove,
    ]);
  });

  it("detects codex by its binary or its config folder", async () => {
    // Given: on PATH with no folder; then off PATH with ~/.codex; then
    // neither
    const onPath = await run(codexHost.detect, { [which]: { code: 0 } });
    mkdirSync(join(home, ".codex"));
    const byFolder = await run(codexHost.detect);
    rmSync(join(home, ".codex"), { recursive: true });
    const neither = await run(codexHost.detect);
    // Then
    expect([onPath.value, byFolder.value, neither.value]).toEqual([
      true,
      true,
      false,
    ]);
  });
});
