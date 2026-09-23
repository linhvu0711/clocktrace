import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  App,
  fakeLaunchd,
  Helper,
  type LaunchdState,
  type Permissions,
} from "@clocktrace/collector";
import { type Command, CommandExecutor, FileSystem } from "@effect/platform";
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
import { parse } from "yaml";

import { Style } from "../src/format.js";
import {
  type HostName,
  HostRemoveError,
  Hosts,
  manualCommand,
  manualRemoveCommand,
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

// A FileSystem where another writer saves `path` right after each read of
// it: `save(n)` lands after read n, `null` deletes, `undefined` does nothing.
const otherWriter = (
  path: string,
  save: (read: number) => string | null | undefined,
) =>
  Layer.effect(
    FileSystem.FileSystem,
    Effect.map(FileSystem.FileSystem, (fs) => {
      let reads = 0;
      return {
        ...fs,
        readFileString: (p: string, encoding?: string) =>
          fs.readFileString(p, encoding).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                if (p !== path) {
                  return;
                }
                const text = save(reads++);
                if (text === null) {
                  rmSync(path);
                } else if (text !== undefined) {
                  writeFileSync(path, text);
                }
              }),
            ),
          ),
      };
    }),
  );

const raceHermes = <A, E>(
  op: (
    h: Hosts,
  ) => Effect.Effect<
    A,
    E,
    FileSystem.FileSystem | CommandExecutor.CommandExecutor
  >,
  writer: ReturnType<typeof otherWriter>,
) =>
  Effect.runPromise(
    Effect.exit(
      Effect.flatMap(Hosts, op).pipe(
        Effect.provide(Hosts.Default),
        Effect.provide(writer),
        Effect.provide(NodeContext.layer),
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

  it("writes the hermes block and keeps other keys", async () => {
    // Given: ~/.hermes/config.yaml holds model: nous-1 and no mcp_servers
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    writeFileSync(path, "model: nous-1\n");
    // When
    const line = await Effect.runPromise(
      Effect.flatMap(Hosts, (h) => h.register("hermes")).pipe(
        Effect.provide(Hosts.Default),
        Effect.provide(NodeContext.layer),
      ),
    );
    // Then
    expect(line).toEqual({ outcome: "registered" });
    expect(parse(readFileSync(path, "utf8"))).toEqual({
      model: "nous-1",
      // biome-ignore lint/style/useNamingConvention: the yaml key is snake_case
      mcp_servers: {
        clocktrace: { command: serverNode, args: [serverEntry, "mcp"] },
      },
    });
  });

  it("a failed add shows the manual command", async () => {
    // Given: codex exits 1 printing "boom", and no prior registration
    const executor = await Effect.runPromise(
      fakeExecutor({
        [addCodex]: {
          code: 1,
          output: "boom",
        },
      }),
    );
    // When
    const line = await register("codex", executor.layer);
    const recorded = await Effect.runPromise(Ref.get(executor.recorded));
    // Then: remove then add, nothing more to put back
    expect(recorded).toEqual([removeCodex, addCodex]);
    expect(line).toEqual({
      outcome: "failed",
      byHand: `codex mcp add clocktrace -- '${serverNode}' '${serverEntry}' 'mcp'`,
    });
  });

  it("a failed add puts back the previous codex registration", async () => {
    // Given: config.toml holds a stale [mcp_servers.clocktrace] table
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(
      join(home, ".codex", "config.toml"),
      '[mcp_servers.clocktrace]\ncommand = "/old/node"\nargs = ["/old/entry.js", "mcp"]\n',
    );
    const executor = await Effect.runPromise(
      fakeExecutor({
        [addCodex]: { code: 1, output: "boom" },
        "codex mcp add clocktrace -- /old/node /old/entry.js mcp": {
          code: 0,
        },
      }),
    );
    // When
    const line = await register("codex", executor.layer);
    const recorded = await Effect.runPromise(Ref.get(executor.recorded));
    // Then
    expect(recorded).toEqual([
      removeCodex,
      addCodex,
      "codex mcp add clocktrace -- /old/node /old/entry.js mcp",
    ]);
    expect(line).toEqual({ outcome: "failed", byHand: manualCommand.codex });
  });

  it("a failed add puts back the previous openclaw registration", async () => {
    // Given: openclaw.json holds the legacy bare-word entry; the add fails
    mkdirSync(join(home, ".openclaw"), { recursive: true });
    writeFileSync(
      join(home, ".openclaw", "openclaw.json"),
      JSON.stringify({
        mcp: {
          servers: { clocktrace: { command: "clocktrace", args: ["mcp"] } },
        },
      }),
    );
    const executor = await Effect.runPromise(
      fakeExecutor({
        [addOpenclaw]: { code: 1, output: "boom" },
        "openclaw mcp add clocktrace --command clocktrace --arg mcp": {
          code: 0,
        },
      }),
    );
    // When
    const line = await register("openclaw", executor.layer);
    const recorded = await Effect.runPromise(Ref.get(executor.recorded));
    // Then
    expect(recorded).toEqual([
      removeOpenclaw,
      addOpenclaw,
      "openclaw mcp add clocktrace --command clocktrace --arg mcp",
    ]);
    expect(line).toEqual({
      outcome: "failed",
      byHand: manualCommand.openclaw,
    });
  });

  it("a failed add restores the prior env map too", async () => {
    // Given: config.toml holds an entry with an [mcp_servers.clocktrace.env]
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(
      join(home, ".codex", "config.toml"),
      '[mcp_servers.clocktrace]\ncommand = "clocktrace"\nargs = ["mcp"]\n\n[mcp_servers.clocktrace.env]\nCLOCKTRACE_DB = "/work/db.db"\n',
    );
    const addCodexWithEnv = `codex mcp add clocktrace --env CLOCKTRACE_DB=/work/db.db -- ${serverNode} ${serverEntry} mcp`;
    const executor = await Effect.runPromise(
      fakeExecutor({
        [addCodexWithEnv]: { code: 1, output: "boom" },
        "codex mcp add clocktrace --env CLOCKTRACE_DB=/work/db.db -- clocktrace mcp":
          { code: 0 },
      }),
    );
    // When
    const line = await register("codex", executor.layer);
    const recorded = await Effect.runPromise(Ref.get(executor.recorded));
    // Then
    expect(recorded).toEqual([
      removeCodex,
      addCodexWithEnv,
      "codex mcp add clocktrace --env CLOCKTRACE_DB=/work/db.db -- clocktrace mcp",
    ]);
    // And the by-hand command keeps the env too
    expect(line).toEqual({
      outcome: "failed",
      byHand: `codex mcp add clocktrace --env 'CLOCKTRACE_DB=/work/db.db' -- '${serverNode}' '${serverEntry}' 'mcp'`,
    });
  });

  it("re-registration keeps the prior env map", async () => {
    // Given: config.toml holds a clocktrace entry with an env sub-table
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(
      join(home, ".codex", "config.toml"),
      '[mcp_servers.clocktrace]\ncommand = "clocktrace"\nargs = ["mcp"]\n\n[mcp_servers.clocktrace.env]\nCLOCKTRACE_DB = "/work/db.db"\n',
    );
    const executor = await Effect.runPromise(
      fakeExecutor({
        [`codex mcp add clocktrace --env CLOCKTRACE_DB=/work/db.db -- ${serverNode} ${serverEntry} mcp`]:
          { code: 0 },
      }),
    );
    // When
    const line = await register("codex", executor.layer);
    const recorded = await Effect.runPromise(Ref.get(executor.recorded));
    // Then: the replacement carries the env the old entry had
    expect(recorded).toEqual([
      removeCodex,
      `codex mcp add clocktrace --env CLOCKTRACE_DB=/work/db.db -- ${serverNode} ${serverEntry} mcp`,
    ]);
    expect(line).toEqual({ outcome: "registered" });
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

  it("hermes rewrites an existing key", async () => {
    // Given: config.yaml holds a stale mcp_servers.clocktrace plus other keys
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    writeFileSync(
      path,
      'model: nous-1\nmcp_servers:\n  clocktrace:\n    command: clocktrace\n    args: ["mcp"]\n',
    );
    // When
    const line = await Effect.runPromise(
      Effect.flatMap(Hosts, (h) => h.register("hermes")).pipe(
        Effect.provide(Hosts.Default),
        Effect.provide(NodeContext.layer),
      ),
    );
    // Then
    expect(line).toEqual({ outcome: "registered" });
    expect(parse(readFileSync(path, "utf8"))).toEqual({
      model: "nous-1",
      // biome-ignore lint/style/useNamingConvention: the yaml key is snake_case
      mcp_servers: {
        clocktrace: { command: serverNode, args: [serverEntry, "mcp"] },
      },
    });
  });

  it("hermes re-registration keeps the env map", async () => {
    // Given: config.yaml holds a clocktrace entry with env
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    writeFileSync(
      path,
      'mcp_servers:\n  clocktrace:\n    command: clocktrace\n    args: ["mcp"]\n    env:\n      CLOCKTRACE_DB: /work/db.db\n',
    );
    // When
    const line = await Effect.runPromise(
      Effect.flatMap(Hosts, (h) => h.register("hermes")).pipe(
        Effect.provide(Hosts.Default),
        Effect.provide(NodeContext.layer),
      ),
    );
    // Then
    expect(line).toEqual({ outcome: "registered" });
    expect(parse(readFileSync(path, "utf8"))).toEqual({
      // biome-ignore lint/style/useNamingConvention: the yaml key is snake_case
      mcp_servers: {
        clocktrace: {
          command: serverNode,
          args: [serverEntry, "mcp"],
          // biome-ignore lint/style/useNamingConvention: the env key is the name
          env: { CLOCKTRACE_DB: "/work/db.db" },
        },
      },
    });
  });

  it("an unreadable hermes config fails by hand instead of overwriting", async () => {
    // Given: ~/.hermes/config.yaml exists but cannot be read
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    writeFileSync(path, "model: nous-1\n");
    chmodSync(path, 0o000);
    // When
    const line = await Effect.runPromise(
      Effect.flatMap(Hosts, (h) => h.register("hermes")).pipe(
        Effect.provide(Hosts.Default),
        Effect.provide(NodeContext.layer),
      ),
    );
    chmodSync(path, 0o644);
    // Then
    expect(line).toEqual({
      outcome: "failed",
      byHand: manualCommand.hermes,
    });
    expect(readFileSync(path, "utf8")).toBe("model: nous-1\n");
  });

  it("a malformed hermes config fails by hand instead of crashing", async () => {
    // Given: ~/.hermes/config.yaml contains invalid YAML
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    writeFileSync(path, "model: [\n");
    // When
    const line = await Effect.runPromise(
      Effect.flatMap(Hosts, (h) => h.register("hermes")).pipe(
        Effect.provide(Hosts.Default),
        Effect.provide(NodeContext.layer),
      ),
    );
    // Then
    expect(line).toEqual({
      outcome: "failed",
      byHand: manualCommand.hermes,
    });
    expect(readFileSync(path, "utf8")).toBe("model: [\n");
  });

  it("hermes setup keeps every byte outside the Registration", async () => {
    // Given: ~/.hermes/config.yaml with its own spacing and flow style
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    writeFileSync(path, "model: nous-1   # note\nother: {command: x}\n");
    // When
    const line = await Effect.runPromise(
      Effect.flatMap(Hosts, (h) => h.register("hermes")).pipe(
        Effect.provide(Hosts.Default),
        Effect.provide(NodeContext.layer),
      ),
    );
    // Then
    expect(line).toEqual({ outcome: "registered" });
    expect(readFileSync(path, "utf8")).toBe(
      `model: nous-1   # note\nother: {command: x}\nmcp_servers:\n  clocktrace:\n    command: ${serverNode}\n    args:\n      - ${serverEntry}\n      - mcp\n`,
    );
  });

  it("a one-line hermes mcp_servers list fails by hand and leaves the file", async () => {
    // Given: mcp_servers is a one-line list that already holds a server
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    writeFileSync(path, "mcp_servers: {foo: {command: foo}}\n");
    // When
    const line = await Effect.runPromise(
      Effect.flatMap(Hosts, (h) => h.register("hermes")).pipe(
        Effect.provide(Hosts.Default),
        Effect.provide(NodeContext.layer),
      ),
    );
    // Then
    expect(line).toEqual({
      outcome: "failed",
      byHand: manualCommand.hermes,
    });
    expect(readFileSync(path, "utf8")).toBe(
      "mcp_servers: {foo: {command: foo}}\n",
    );
  });

  it("a symlinked hermes config writes the target and keeps its mode", async () => {
    // Given: ~/.hermes/config.yaml is a symlink to a 0600 dotfiles file
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const target = join(home, "dotfiles", "hermes.yaml");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, "model: nous-1\n");
    chmodSync(target, 0o600);
    const link = join(home, ".hermes", "config.yaml");
    symlinkSync(target, link);
    // When
    const line = await Effect.runPromise(
      Effect.flatMap(Hosts, (h) => h.register("hermes")).pipe(
        Effect.provide(Hosts.Default),
        Effect.provide(NodeContext.layer),
      ),
    );
    // Then
    expect(line).toEqual({ outcome: "registered" });
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, "utf8")).toContain("clocktrace");
    expect(statSync(target).mode & 0o777).toBe(0o600);
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

  it("codex without the server exits 0 and is still not registered", async () => {
    // Given: codex on PATH; its remove exits 0 with the real message
    const executor = await Effect.runPromise(
      fakeExecutor({
        "which codex": { code: 0 },
        "codex mcp remove clocktrace": {
          code: 0,
          output: "No MCP server named 'clocktrace' found.",
        },
      }),
    );
    // When
    const outcome = await unregister("codex", executor.layer);
    // Then
    expect(outcome).toEqual(Exit.succeed("not registered"));
  });

  it("a failed remove is a HostRemoveError with the manual command", async () => {
    // Given: codex on PATH; its remove exits 1 printing boom
    const executor = await Effect.runPromise(
      fakeExecutor({
        "which codex": { code: 0 },
        "codex mcp remove clocktrace": { code: 1, output: "boom" },
      }),
    );
    // When
    const outcome = await unregister("codex", executor.layer);
    // Then
    expect(outcome).toEqual(Exit.fail(new HostRemoveError({ host: "codex" })));
    expect(new HostRemoveError({ host: "codex" }).message).toBe(
      `Codex failed · run by hand: ${manualRemoveCommand.codex}`,
    );
  });

  it("a host binary missing from PATH is no cli and runs no remove", async () => {
    // Given: which codex exits 1
    const executor = await Effect.runPromise(fakeExecutor({}));
    // When
    const outcome = await unregister("codex", executor.layer);
    const recorded = await Effect.runPromise(Ref.get(executor.recorded));
    // Then
    expect(outcome).toEqual(Exit.succeed("no cli"));
    expect(recorded).toEqual(["which codex"]);
  });

  it("hermes unregister removes the block and keeps other keys", async () => {
    // Given: config.yaml with a model and two servers
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    writeFileSync(
      path,
      'model: nous-1\nmcp_servers:\n  clocktrace:\n    command: clocktrace\n    args: ["mcp"]\n  other:\n    command: other\n',
    );
    // When
    const outcome = await unregister("hermes");
    // Then
    expect(outcome).toEqual(Exit.succeed("unregistered"));
    expect(parse(readFileSync(path, "utf8"))).toEqual({
      model: "nous-1",
      // biome-ignore lint/style/useNamingConvention: the yaml key is snake_case
      mcp_servers: { other: { command: "other" } },
    });
  });

  it("hermes unregister with the key absent leaves the file unchanged", async () => {
    // Given: config.yaml without mcp_servers.clocktrace
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    const text = "model: nous-1\n";
    writeFileSync(path, text);
    // When
    const outcome = await unregister("hermes");
    // Then
    expect(outcome).toEqual(Exit.succeed("not registered"));
    expect(readFileSync(path, "utf8")).toBe(text);
  });

  it("hermes unregister without a config file is not registered", async () => {
    // Given: no ~/.hermes at all
    // When
    const outcome = await unregister("hermes");
    // Then
    expect(outcome).toEqual(Exit.succeed("not registered"));
    expect(existsSync(join(home, ".hermes"))).toBe(false);
  });

  it("hermes unregister on a malformed config is a HostRemoveError", async () => {
    // Given: ~/.hermes/config.yaml contains invalid YAML
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    writeFileSync(path, "model: [\n");
    // When
    const outcome = await unregister("hermes");
    // Then
    expect(outcome).toEqual(Exit.fail(new HostRemoveError({ host: "hermes" })));
    expect(readFileSync(path, "utf8")).toBe("model: [\n");
  });

  it("hermes setup then uninstall gives back the file byte for byte", async () => {
    // Given: ~/.hermes/config.yaml with its own spacing, blank lines, and hex
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    const original =
      "model: nous-1   # note\nother: {command: x}\n\n\nz: 0x1F\n";
    writeFileSync(path, original);
    await Effect.runPromise(
      Effect.flatMap(Hosts, (h) => h.register("hermes")).pipe(
        Effect.provide(Hosts.Default),
        Effect.provide(NodeContext.layer),
      ),
    );
    // When
    const outcome = await unregister("hermes");
    // Then
    expect(outcome).toEqual(Exit.succeed("unregistered"));
    expect(readFileSync(path, "utf8")).toBe(original);
  });

  it("hermes unregister on a one-line mcp_servers list is a HostRemoveError", async () => {
    // Given: the Registration sits inside a one-line mcp_servers list
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    writeFileSync(path, "mcp_servers: {clocktrace: {command: x}}\n");
    // When
    const outcome = await unregister("hermes");
    // Then
    expect(outcome).toEqual(Exit.fail(new HostRemoveError({ host: "hermes" })));
    expect(readFileSync(path, "utf8")).toBe(
      "mcp_servers: {clocktrace: {command: x}}\n",
    );
  });

  it("hermes register keeps a save made during the edit", async () => {
    // Given: Hermes saves config.yaml right after setup reads it
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    writeFileSync(path, "model: nous-1\n");
    const writer = otherWriter(path, (n) =>
      n === 0 ? "model: nous-2\n" : undefined,
    );
    // When
    const outcome = await raceHermes((h) => h.register("hermes"), writer);
    // Then
    expect(outcome).toEqual(Exit.succeed({ outcome: "registered" }));
    expect(parse(readFileSync(path, "utf8"))).toEqual({
      model: "nous-2",
      // biome-ignore lint/style/useNamingConvention: the yaml key is snake_case
      mcp_servers: {
        clocktrace: { command: serverNode, args: [serverEntry, "mcp"] },
      },
    });
  });

  it("hermes unregister keeps a save made during the edit", async () => {
    // Given: Hermes saves config.yaml right after uninstall reads it
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    const registered = (model: string) =>
      `model: ${model}\nmcp_servers:\n  clocktrace:\n    command: x\n`;
    writeFileSync(path, registered("nous-1"));
    const writer = otherWriter(path, (n) =>
      n === 0 ? registered("nous-2") : undefined,
    );
    // When
    const outcome = await raceHermes((h) => h.unregister("hermes"), writer);
    // Then
    expect(outcome).toEqual(Exit.succeed("unregistered"));
    expect(readFileSync(path, "utf8")).toBe("model: nous-2\n");
  });

  it("hermes gives up after 3 changed reads and keeps the other save", async () => {
    // Given: Hermes saves config.yaml after every read, so no try is clean
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    writeFileSync(path, "model: nous-1\n");
    let last = "";
    const writer = otherWriter(path, (n) => {
      last = `model: nous-${n + 2}\n`;
      return last;
    });
    // When
    const outcome = await raceHermes((h) => h.register("hermes"), writer);
    // Then
    expect(outcome).toEqual(
      Exit.succeed({ outcome: "failed", byHand: manualCommand.hermes }),
    );
    expect(readFileSync(path, "utf8")).toBe(last);
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it("hermes unregister gives up after 3 changed reads with a HostRemoveError", async () => {
    // Given: Hermes saves config.yaml after every read, so no try is clean
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    const registered = (model: string) =>
      `model: ${model}\nmcp_servers:\n  clocktrace:\n    command: x\n`;
    writeFileSync(path, registered("nous-1"));
    let last = "";
    const writer = otherWriter(path, (n) => {
      last = registered(`nous-${n + 2}`);
      return last;
    });
    // When
    const outcome = await raceHermes((h) => h.unregister("hermes"), writer);
    // Then
    expect(outcome).toEqual(Exit.fail(new HostRemoveError({ host: "hermes" })));
    expect(readFileSync(path, "utf8")).toBe(last);
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it("hermes register after the file is deleted mid-edit writes only the registration", async () => {
    // Given: the user deletes config.yaml right after setup reads it
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    writeFileSync(path, "model: nous-1\n");
    const writer = otherWriter(path, (n) => (n === 0 ? null : undefined));
    // When
    const outcome = await raceHermes((h) => h.register("hermes"), writer);
    // Then
    expect(outcome).toEqual(Exit.succeed({ outcome: "registered" }));
    expect(parse(readFileSync(path, "utf8"))).toEqual({
      // biome-ignore lint/style/useNamingConvention: the yaml key is snake_case
      mcp_servers: {
        clocktrace: { command: serverNode, args: [serverEntry, "mcp"] },
      },
    });
  });
});
