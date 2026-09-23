import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CommandExecutor, FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Effect, Layer, Ref } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { serverEntry, serverNode } from "../src/host.js";
import { openclawHost } from "../src/openclaw-host.js";
import { type ExecResult, fakeExecutor } from "./mock-executor.js";

const which = "which openclaw";
const add = `openclaw mcp add clocktrace --command ${serverNode} --arg ${serverEntry} --arg mcp`;
const addWithEnv = `openclaw mcp add clocktrace --command ${serverNode} --env CLOCKTRACE_DB=/work/db.db --arg ${serverEntry} --arg mcp`;
const restoreOld = "openclaw mcp add clocktrace --command clocktrace --arg mcp";
const remove = "openclaw mcp unset clocktrace";
const manualAdd = `openclaw mcp add clocktrace --command '${serverNode}' --arg '${serverEntry}' --arg 'mcp'`;

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

describe("openclaw host", () => {
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "clocktrace-home-"));
    vi.stubEnv("HOME", home);
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  const writeConfig = (clocktrace: unknown) => {
    mkdirSync(join(home, ".openclaw"), { recursive: true });
    writeFileSync(
      join(home, ".openclaw", "openclaw.json"),
      JSON.stringify({ mcp: { servers: { clocktrace } } }),
    );
  };

  it("registers with remove then add", async () => {
    // Given: no openclaw.json; the add exits 0
    // When
    const { value, recorded } = await run(openclawHost.register, {
      [add]: { code: 0 },
    });
    // Then
    expect(value).toEqual({ outcome: "registered" });
    expect(recorded).toEqual([remove, add]);
  });

  it("re-registration keeps the prior env map", async () => {
    // Given: openclaw.json holds a clocktrace entry with an env map
    writeConfig({
      command: "clocktrace",
      args: ["mcp"],
      // biome-ignore lint/style/useNamingConvention: the env key is the name
      env: { CLOCKTRACE_DB: "/work/db.db" },
    });
    // When
    const { value, recorded } = await run(openclawHost.register, {
      [addWithEnv]: { code: 0 },
    });
    // Then: the replacement carries the env the old entry had
    expect(value).toEqual({ outcome: "registered" });
    expect(recorded).toEqual([remove, addWithEnv]);
  });

  it("a failed add puts back the previous openclaw registration", async () => {
    // Given: openclaw.json holds the legacy bare-word entry; the add fails
    writeConfig({ command: "clocktrace", args: ["mcp"] });
    // When
    const { value, recorded } = await run(openclawHost.register, {
      [add]: { code: 1, output: "boom" },
      [restoreOld]: { code: 0 },
    });
    // Then
    expect(recorded).toEqual([remove, add, restoreOld]);
    expect(value).toEqual({ outcome: "failed", byHand: manualAdd });
  });

  it("unregisters with its own command", async () => {
    // Given: openclaw on PATH; its unset exits 0
    // When
    const { value, recorded } = await run(openclawHost.unregister, {
      [which]: { code: 0 },
      [remove]: { code: 0 },
    });
    // Then
    expect(value).toBe("unregistered");
    expect(recorded).toEqual([which, remove]);
  });

  it("without the server is not registered", async () => {
    // Given: openclaw on PATH; its unset exits 1 saying there is none
    // When
    const { value } = await run(openclawHost.unregister, {
      [which]: { code: 0 },
      [remove]: { code: 1, output: 'No MCP server named "clocktrace"' },
    });
    // Then
    expect(value).toBe("not registered");
  });

  it("a failed remove is failed", async () => {
    // Given: openclaw on PATH; its unset exits 1 printing boom
    // When
    const { value } = await run(openclawHost.unregister, {
      [which]: { code: 0 },
      [remove]: { code: 1, output: "boom" },
    });
    // Then
    expect(value).toBe("failed");
  });

  it("missing from PATH is no cli and runs no remove", async () => {
    // Given: openclaw is not on PATH
    // When
    const { value, recorded } = await run(openclawHost.unregister);
    // Then
    expect(value).toBe("no cli");
    expect(recorded).toEqual([which]);
  });

  it("manual commands quote the node and entry paths", () => {
    expect([openclawHost.manualAdd, openclawHost.manualRemove]).toEqual([
      manualAdd,
      remove,
    ]);
  });

  it("detects openclaw by its binary or its config folder", async () => {
    // Given: on PATH with no folder; then off PATH with ~/.openclaw;
    // then neither
    const onPath = await run(openclawHost.detect, { [which]: { code: 0 } });
    mkdirSync(join(home, ".openclaw"));
    const byFolder = await run(openclawHost.detect);
    rmSync(join(home, ".openclaw"), { recursive: true });
    const neither = await run(openclawHost.detect);
    // Then
    expect([onPath.value, byFolder.value, neither.value]).toEqual([
      true,
      true,
      false,
    ]);
  });
});
