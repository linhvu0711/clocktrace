import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  App,
  fakeLaunchd,
  Helper,
  type LaunchdState,
  type Permissions,
} from "@clocktrace/collector";
import { type Command, CommandExecutor } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import {
  ConfigProvider,
  Console,
  DateTime,
  Effect,
  Exit,
  Layer,
  Ref,
  Sink,
  Stream,
} from "effect";
import { NodeInspectSymbol } from "effect/Inspectable";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Style } from "../src/format.js";
import {
  type HostName,
  Hosts,
  manualCommand,
  serverEntry,
  serverNode,
} from "../src/hosts.js";
import { Prompt, Stdin, StoppedError } from "../src/prompt.js";
import { setup } from "../src/setup.js";
import * as MockConsole from "./mock-console.js";
import * as MockTerminal from "./mock-terminal.js";

type Key = { readonly key: string; readonly ctrl?: boolean } | string;

const allGranted: Permissions = {
  accessibility: "granted",
  automation: {},
  fullDiskAccess: "granted",
};

const helperStub = (p: Permissions) =>
  Helper.Test({ permissions: () => Effect.succeed(p) });

type ExecResult = { readonly code: number; readonly output?: string };

const argvOf = (command: Command.Command): ReadonlyArray<string> =>
  command._tag === "StandardCommand" ? [command.command, ...command.args] : [];

const fakeProcess = (
  code: number,
  output: string,
): CommandExecutor.Process => ({
  [CommandExecutor.ProcessTypeId]: CommandExecutor.ProcessTypeId,
  pid: 0 as CommandExecutor.ProcessId,
  exitCode: Effect.succeed(code as CommandExecutor.ExitCode),
  isRunning: Effect.succeed(false),
  kill: () => Effect.void,
  stdin: Sink.drain,
  stdout: Stream.make(new TextEncoder().encode(output)),
  stderr: Stream.empty,
  toJSON: () => ({}),
  toString: () => "",
  [NodeInspectSymbol]: () => ({}),
});

const fakeExecutor = (
  results: Record<string, ExecResult>,
): Effect.Effect<{
  readonly layer: Layer.Layer<CommandExecutor.CommandExecutor>;
  readonly recorded: Ref.Ref<ReadonlyArray<string>>;
}> =>
  Effect.gen(function* () {
    const recorded = yield* Ref.make<ReadonlyArray<string>>([]);
    const lineOf = (command: Command.Command) => argvOf(command).join(" ");
    const resultOf = (command: Command.Command) =>
      results[lineOf(command)] ?? { code: 1 };
    const executor: CommandExecutor.CommandExecutor = {
      [CommandExecutor.TypeId]: CommandExecutor.TypeId,
      exitCode: (command) =>
        Ref.update(recorded, (r) => [...r, lineOf(command)]).pipe(
          Effect.andThen(
            Effect.succeed(resultOf(command).code as CommandExecutor.ExitCode),
          ),
        ),
      start: (command) =>
        Ref.update(recorded, (r) => [...r, lineOf(command)]).pipe(
          Effect.andThen(() => {
            const r = resultOf(command);
            return Effect.succeed(fakeProcess(r.code, r.output ?? ""));
          }),
        ),
      string: () => Effect.succeed(""),
      lines: () => Effect.succeed([]),
      stream: () => Stream.empty,
      streamLines: () => Stream.empty,
    };
    return {
      recorded,
      layer: Layer.succeed(CommandExecutor.CommandExecutor, executor),
    };
  });

const addClaude = `claude mcp add --scope user clocktrace -- ${serverNode} ${serverEntry} mcp`;
const addCodex = `codex mcp add clocktrace -- ${serverNode} ${serverEntry} mcp`;
const addOpenclaw = `openclaw mcp add clocktrace --command ${serverNode} --arg ${serverEntry} --arg mcp`;
const removeClaude = "claude mcp remove clocktrace --scope user";
const removeCodex = "codex mcp remove clocktrace";
const removeOpenclaw = "openclaw mcp unset clocktrace";

const register = (
  host: HostName,
  executorLayer: Layer.Layer<CommandExecutor.CommandExecutor>,
) =>
  Effect.runPromise(
    Effect.flatMap(Hosts, (h) => h.register(host)).pipe(
      Effect.provide(Hosts.Default),
      Effect.provide(Layer.mergeAll(NodeContext.layer, executorLayer)),
    ),
  );

// Hermes touches no binary, so it runs on NodeContext alone.
const unregister = (
  host: HostName,
  executorLayer?: Layer.Layer<CommandExecutor.CommandExecutor>,
) =>
  Effect.runPromise(
    Effect.exit(
      Effect.flatMap(Hosts, (h) => h.unregister(host)).pipe(
        Effect.provide(Hosts.Default),
        Effect.provide(
          executorLayer === undefined
            ? NodeContext.layer
            : Layer.mergeAll(NodeContext.layer, executorLayer),
        ),
      ),
    ),
  );

let dir: string;
let home: string;

describe("hosts", () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clocktrace-"));
    home = mkdtempSync(join(tmpdir(), "clocktrace-home-"));
    vi.stubEnv("HOME", home);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  const runSetup = (
    hosts: ReadonlyArray<HostName> | undefined,
    opts: {
      readonly keys?: ReadonlyArray<Key>;
      readonly interactive?: boolean;
      readonly results?: Record<string, ExecResult>;
    } = {},
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = yield* MockTerminal.make(opts.interactive ?? false);
        const console = yield* MockConsole.make;
        for (const k of opts.keys ?? []) {
          yield* typeof k === "string"
            ? terminal.inputText(k)
            : terminal.inputKey(
                k.key,
                k.ctrl === undefined ? {} : { ctrl: k.ctrl },
              );
        }
        const executor = yield* fakeExecutor(opts.results ?? {});
        const state = yield* Ref.make<LaunchdState>({
          installed: false,
          running: false,
          plist: null,
          installs: 0,
        });
        const layers = Layer.mergeAll(
          Console.setConsole(console),
          NodeContext.layer,
          terminal.layer,
          Prompt.Default,
          Stdin.Test,
          fakeLaunchd(state),
          helperStub(allGranted),
          App.Test,
          Hosts.Default,
          executor.layer,
          Style.Test,
        );
        const exit = yield* Effect.exit(
          setup(hosts).pipe(Effect.provide(layers)),
        );
        return {
          exit,
          output: yield* console.getLines({ stripAnsi: true }),
          shown: yield* terminal.shown,
          recorded: yield* Ref.get(executor.recorded),
        };
      }).pipe(
        Effect.withConfigProvider(
          ConfigProvider.fromMap(
            new Map([
              ["CLOCKTRACE_HELPER", "/stub"],
              ["CLOCKTRACE_DB", join(dir, "clocktrace.db")],
            ]),
          ),
        ),
        DateTime.withCurrentZoneNamed("America/Los_Angeles"),
      ),
    );

  it("detects a host by binary or config folder", async () => {
    // Given: ~/.codex exists; `which claude` exits 0, the others non-zero
    mkdirSync(join(home, ".codex"));
    const executor = await Effect.runPromise(
      fakeExecutor({
        "which claude": { code: 0 },
        "which codex": { code: 1 },
        "which openclaw": { code: 1 },
      }),
    );
    // When
    const detected = await Effect.runPromise(
      Effect.flatMap(Hosts, (h) => h.detect()).pipe(
        Effect.provide(Hosts.Default),
        Effect.provide(Layer.mergeAll(NodeContext.layer, executor.layer)),
      ),
    );
    // Then
    expect(detected).toEqual({
      claude: true,
      codex: true,
      hermes: false,
      openclaw: false,
    });
  });

  it("registers each host with its own command", async () => {
    // Given: a recording CommandExecutor whose exits are 0
    const executor = await Effect.runPromise(
      fakeExecutor({
        [addClaude]: { code: 0 },
        [addCodex]: { code: 0 },
        [addOpenclaw]: { code: 0 },
      }),
    );
    // When
    const lines = [
      await register("claude", executor.layer),
      await register("codex", executor.layer),
      await register("openclaw", executor.layer),
    ];
    const recorded = await Effect.runPromise(Ref.get(executor.recorded));
    // Then: each register removes first, then adds
    expect(recorded).toEqual([
      removeClaude,
      addClaude,
      removeCodex,
      addCodex,
      removeOpenclaw,
      addOpenclaw,
    ]);
    expect(lines).toEqual([
      { outcome: "registered" },
      { outcome: "registered" },
      { outcome: "registered" },
    ]);
  });

  it("manual commands quote the node and entry paths", () => {
    expect(manualCommand.claude).toBe(
      `claude mcp add --scope user clocktrace -- '${serverNode}' '${serverEntry}' 'mcp'`,
    );
    expect(manualCommand.codex).toBe(
      `codex mcp add clocktrace -- '${serverNode}' '${serverEntry}' 'mcp'`,
    );
    expect(manualCommand.openclaw).toBe(
      `openclaw mcp add clocktrace --command '${serverNode}' --arg '${serverEntry}' --arg 'mcp'`,
    );
  });

  it("a failed add prints the ✘ line with the absolute command", async () => {
    // Given: the codex add exits 1 printing "boom"
    // When
    const { exit, output } = await runSetup(["codex"], {
      interactive: false,
      results: {
        [addCodex]: { code: 1, output: "boom" },
      },
    });
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toContain(
      `  ✘ Codex failed · run by hand: codex mcp add clocktrace -- '${serverNode}' '${serverEntry}' 'mcp'`,
    );
  });

  it("the checklist registers the ticked hosts", async () => {
    // Given: `which claude` exits 0, the others non-zero; no host config dirs
    // When: down to Codex, space ticks it, enter registers claude and codex
    const { exit, output, shown, recorded } = await runSetup(undefined, {
      keys: [
        { key: "down" },
        { key: "down" },
        { key: "down" },
        { key: "space" },
        { key: "enter" },
      ],
      interactive: true,
      results: {
        "which claude": { code: 0 },
        "which codex": { code: 1 },
        "which openclaw": { code: 1 },
        [addClaude]: { code: 0 },
        [addCodex]: { code: 0 },
      },
    });
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(shown).toContain(
      "? Hosts  ↑↓ move · space toggle · enter register ›",
    );
    expect(shown).toContain("  ☒ Claude Code - found");
    expect(shown).toContain("  ☐ Codex");
    expect(shown).toContain("  ☐ Hermes Agent");
    expect(shown).toContain("  ☐ OpenClaw");
    expect(shown).toContain("  ☒ Codex");
    expect(recorded.slice(-4)).toEqual([
      removeClaude,
      addClaude,
      removeCodex,
      addCodex,
    ]);
    expect(output).toContain("  ✔ Claude Code registered");
    expect(output).toContain("  ✔ Codex registered");
  });

  it("ctrl-c at the checklist stops setup and registers nothing", async () => {
    // Given: claude detected; ctrl-c arrives at the checklist
    // When
    const { exit, output, recorded } = await runSetup(undefined, {
      keys: [{ key: "c", ctrl: true }],
      interactive: true,
      results: {
        "which claude": { code: 0 },
        "which codex": { code: 1 },
        "which openclaw": { code: 1 },
      },
    });
    // Then
    expect(exit).toEqual(Exit.fail(new StoppedError()));
    expect(recorded).not.toContain(
      "claude mcp add --scope user clocktrace -- clocktrace mcp",
    );
    expect(output.every((line) => !line.endsWith("registered"))).toBe(true);
  });

  it("a key other than arrows, space, enter does nothing at the checklist", async () => {
    // Given: claude detected; an unrelated key, then enter
    // When
    const { exit, output, shown } = await runSetup(undefined, {
      keys: ["x", { key: "enter" }],
      interactive: true,
      results: {
        "which claude": { code: 0 },
        "which codex": { code: 1 },
        "which openclaw": { code: 1 },
        [addClaude]: { code: 0 },
      },
    });
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(shown.split("Inverse Selection")).toHaveLength(2);
    expect(output).toContain("  ✔ Claude Code registered");
  });

  it("non-tty with --hosts registers the named without a checklist", async () => {
    // Given: the mock terminal is not a TTY; hosts = claude, codex
    // When
    const { exit, output, shown, recorded } = await runSetup(
      ["claude", "codex"],
      {
        interactive: false,
        results: {
          [addClaude]: { code: 0 },
          [addCodex]: { code: 0 },
        },
      },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(recorded).toEqual([removeClaude, addClaude, removeCodex, addCodex]);
    expect(output).toContain("  ✔ Claude Code registered");
    expect(output).toContain("  ✔ Codex registered");
    expect(shown).not.toContain("Hosts");
  });

  it("unregisters each host with its own command", async () => {
    // Given: each host binary on PATH; each remove exits 0
    const executor = await Effect.runPromise(
      fakeExecutor({
        "which claude": { code: 0 },
        "which codex": { code: 0 },
        "which openclaw": { code: 0 },
        "claude mcp remove clocktrace --scope user": { code: 0 },
        "codex mcp remove clocktrace": { code: 0 },
        "openclaw mcp unset clocktrace": { code: 0 },
      }),
    );
    // When
    const outcomes = [
      await unregister("claude", executor.layer),
      await unregister("codex", executor.layer),
      await unregister("openclaw", executor.layer),
    ];
    const recorded = await Effect.runPromise(Ref.get(executor.recorded));
    // Then
    expect(recorded).toEqual([
      "which claude",
      "claude mcp remove clocktrace --scope user",
      "which codex",
      "codex mcp remove clocktrace",
      "which openclaw",
      "openclaw mcp unset clocktrace",
    ]);
    expect(outcomes).toEqual([
      Exit.succeed("unregistered"),
      Exit.succeed("unregistered"),
      Exit.succeed("unregistered"),
    ]);
  });
});
