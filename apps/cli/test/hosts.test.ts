import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fakeLaunchd,
  Helper,
  type LaunchdState,
  type Permissions,
} from "@clocktrace/collector";
import { type Command, CommandExecutor } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import {
  ConfigProvider,
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

import { type HostName, Hosts, manualCommand } from "../src/hosts.js";
import { fakePrompt } from "../src/prompt.js";
import { setup } from "../src/setup.js";

const allGranted: Permissions = {
  accessibility: "granted",
  automation: {},
  fullDiskAccess: "granted",
};

const helperStub = (p: Permissions) =>
  Layer.succeed(
    Helper,
    new Helper({
      check: () => Effect.void,
      lines: () => Stream.empty,
      permissions: () => Effect.succeed(p),
      request: () => Effect.succeed("asked"),
    }),
  );

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
      readonly answers?: ReadonlyArray<string>;
      readonly interactive?: boolean;
      readonly results?: Record<string, ExecResult>;
    } = {},
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const prompt = yield* fakePrompt(
          opts.answers ?? [],
          opts.interactive ?? false,
        );
        const executor = yield* fakeExecutor(opts.results ?? {});
        const state = yield* Ref.make<LaunchdState>({
          installed: false,
          running: false,
          plist: null,
          installs: 0,
        });
        const layers = Layer.mergeAll(
          prompt.layer,
          fakeLaunchd(state),
          helperStub(allGranted),
          Hosts.Default,
          NodeContext.layer,
          executor.layer,
        );
        const exit = yield* Effect.exit(
          setup(hosts).pipe(Effect.provide(layers)),
        );
        return {
          exit,
          output: yield* Ref.get(prompt.output),
          questions: yield* Ref.get(prompt.questions),
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
        "claude mcp add --scope user clocktrace -- clocktrace mcp": { code: 0 },
        "codex mcp add clocktrace -- clocktrace mcp": { code: 0 },
        "openclaw mcp add clocktrace --command clocktrace --arg mcp": {
          code: 0,
        },
      }),
    );
    // When
    const lines = [
      await register("claude", executor.layer),
      await register("codex", executor.layer),
      await register("openclaw", executor.layer),
    ];
    const recorded = await Effect.runPromise(Ref.get(executor.recorded));
    // Then
    expect(recorded).toEqual([
      "claude mcp add --scope user clocktrace -- clocktrace mcp",
      "codex mcp add clocktrace -- clocktrace mcp",
      "openclaw mcp add clocktrace --command clocktrace --arg mcp",
    ]);
    expect(lines).toEqual([
      "claude code: registered",
      "codex: registered",
      "openclaw: registered",
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
    expect(line).toBe("hermes agent: registered");
    expect(parse(readFileSync(path, "utf8"))).toEqual({
      model: "nous-1",
      // biome-ignore lint/style/useNamingConvention: the yaml key is snake_case
      mcp_servers: {
        clocktrace: { command: "clocktrace", args: ["mcp"] },
      },
    });
  });

  it("an add that reports the server exists is already registered", async () => {
    // Given: claude exits 1 printing "already exists"
    const executor = await Effect.runPromise(
      fakeExecutor({
        "claude mcp add --scope user clocktrace -- clocktrace mcp": {
          code: 1,
          output: "error: already exists",
        },
      }),
    );
    // When
    const line = await register("claude", executor.layer);
    // Then
    expect(line).toBe("claude code: already registered");
  });

  it("a failed add shows the manual command", async () => {
    // Given: codex exits 1 printing "boom"
    const executor = await Effect.runPromise(
      fakeExecutor({
        "codex mcp add clocktrace -- clocktrace mcp": {
          code: 1,
          output: "boom",
        },
      }),
    );
    // When
    const line = await register("codex", executor.layer);
    // Then
    expect(line).toBe(
      "codex: failed. run by hand: codex mcp add clocktrace -- clocktrace mcp",
    );
  });

  it("hermes already registered leaves the file unchanged", async () => {
    // Given: config.yaml already holds mcp_servers.clocktrace plus other keys
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    const text =
      'model: nous-1\nmcp_servers:\n  clocktrace:\n    command: clocktrace\n    args: ["mcp"]\n';
    writeFileSync(path, text);
    // When
    const line = await Effect.runPromise(
      Effect.flatMap(Hosts, (h) => h.register("hermes")).pipe(
        Effect.provide(Hosts.Default),
        Effect.provide(NodeContext.layer),
      ),
    );
    // Then
    expect(line).toBe("hermes agent: already registered");
    expect(readFileSync(path, "utf8")).toBe(text);
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
    expect(line).toBe(
      `hermes agent: failed. run by hand: ${manualCommand.hermes}`,
    );
    expect(readFileSync(path, "utf8")).toBe("model: nous-1\n");
  });

  it("the checklist registers the ticked hosts", async () => {
    // Given: `which claude` exits 0, the others non-zero; no host config dirs
    // When
    const { exit, output } = await runSetup(undefined, {
      answers: [""],
      interactive: true,
      results: {
        "which claude": { code: 0 },
        "which codex": { code: 1 },
        "which openclaw": { code: 1 },
        "claude mcp add --scope user clocktrace -- clocktrace mcp": {
          code: 0,
        },
      },
    });
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toContain("1. [x] claude code");
    expect(output).toContain("claude code: registered");
  });

  it("non-tty with --hosts registers the named without a checklist", async () => {
    // Given: fakePrompt interactive: false; hosts = claude, codex
    // When
    const { exit, output, questions, recorded } = await runSetup(
      ["claude", "codex"],
      {
        interactive: false,
        results: {
          "claude mcp add --scope user clocktrace -- clocktrace mcp": {
            code: 0,
          },
          "codex mcp add clocktrace -- clocktrace mcp": { code: 0 },
        },
      },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(recorded).toEqual([
      "claude mcp add --scope user clocktrace -- clocktrace mcp",
      "codex mcp add clocktrace -- clocktrace mcp",
    ]);
    expect(output).toContain("claude code: registered");
    expect(output).toContain("codex: registered");
    expect(questions).toEqual([]);
  });
});
