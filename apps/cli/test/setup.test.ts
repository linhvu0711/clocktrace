import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  entryPath,
  fakeLaunchd,
  Helper,
  HelperNotFoundError,
  type LaunchdState,
  type Permissions,
  plistPath,
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

import {
  type HostName,
  Hosts,
  hostLabel,
  hostNames,
  manualCommand,
} from "../src/hosts.js";
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

const fakeProcess = (code: number): CommandExecutor.Process => ({
  [CommandExecutor.ProcessTypeId]: CommandExecutor.ProcessTypeId,
  pid: 0 as CommandExecutor.ProcessId,
  exitCode: Effect.succeed(code as CommandExecutor.ExitCode),
  isRunning: Effect.succeed(false),
  kill: () => Effect.void,
  stdin: Sink.drain,
  stdout: Stream.empty,
  stderr: Stream.empty,
  toJSON: () => ({}),
  toString: () => "",
  [NodeInspectSymbol]: () => ({}),
});

// `which` finds no host binary; every spawned add command succeeds.
const noCommandsLayer = Layer.succeed(CommandExecutor.CommandExecutor, {
  [CommandExecutor.TypeId]: CommandExecutor.TypeId,
  exitCode: () => Effect.succeed(1 as CommandExecutor.ExitCode),
  start: (_command: Command.Command) => Effect.succeed(fakeProcess(0)),
  string: () => Effect.succeed(""),
  lines: () => Effect.succeed([]),
  stream: () => Stream.empty,
  streamLines: () => Stream.empty,
} satisfies CommandExecutor.CommandExecutor);

const manualLines = hostNames.map(
  (h) => `${hostLabel[h]}: ${manualCommand[h]}`,
);

describe("setup", () => {
  let dir: string;
  let home: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clocktrace-"));
    home = mkdtempSync(join(tmpdir(), "clocktrace-home-"));
    path = join(dir, "clocktrace.db");
    vi.stubEnv("HOME", home);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  const run = (
    helperLayer: Layer.Layer<Helper>,
    launchdState: LaunchdState,
    helperPath = "/stub",
    opts: {
      readonly hosts?: ReadonlyArray<HostName>;
      readonly answers?: ReadonlyArray<string>;
      readonly interactive?: boolean;
    } = {},
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const prompt = yield* fakePrompt(
          opts.answers ?? [],
          opts.interactive ?? false,
        );
        const state = yield* Ref.make(launchdState);
        const layers = Layer.mergeAll(
          prompt.layer,
          fakeLaunchd(state),
          helperLayer,
          Hosts.Default,
          NodeContext.layer,
          noCommandsLayer,
        );
        const exit = yield* Effect.exit(
          setup(opts.hosts).pipe(Effect.provide(layers)),
        );
        return {
          exit,
          output: yield* Ref.get(prompt.output),
          questions: yield* Ref.get(prompt.questions),
          state: yield* Ref.get(state),
        };
      }).pipe(
        Effect.withConfigProvider(
          ConfigProvider.fromMap(
            new Map([
              ["CLOCKTRACE_HELPER", helperPath],
              ["CLOCKTRACE_DB", path],
            ]),
          ),
        ),
        DateTime.withCurrentZoneNamed("America/Los_Angeles"),
      ),
    );

  const expectedWalk = () => [
    "accessibility: window titles",
    "  denied: window titles are not tracked",
    "accessibility: granted",
    "full disk access: iPhone and iPad import",
    "  denied: iPhone and iPad time is not imported",
    "full disk access: granted",
    "collector: running",
    "accessibility: granted",
    "full disk access: granted",
    "last activity: none yet",
    `database: ${path}`,
    ...manualLines,
  ];

  it("setup creates the database, installs the Collector, walks the permissions, and prints the manual commands", async () => {
    // Given: no plist and no database file
    // When
    const { exit, output, state } = await run(helperStub(allGranted), {
      installed: false,
      running: false,
      plist: null,
      installs: 0,
    });
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual([
      `launchd agent: written ${plistPath}`,
      ...expectedWalk(),
    ]);
    expect(existsSync(path)).toBe(true);
    expect(state.installed).toBe(true);
    expect(state.running).toBe(true);
    expect(state.installs).toBe(1);
    expect(state.plist).toContain(`<string>${process.execPath}</string>`);
    expect(state.plist).toContain(`<string>${entryPath}</string>`);
    expect(state.plist).toContain(`<string>${path}</string>`);
    expect(state.plist).toContain("<string>/stub</string>");
  });

  it("setup again keeps the database and the agent and runs only permissions", async () => {
    // Given: one setup already run
    const first = await run(helperStub(allGranted), {
      installed: false,
      running: false,
      plist: null,
      installs: 0,
    });
    // When
    const second = await run(helperStub(allGranted), first.state);
    // Then
    expect(Exit.isSuccess(second.exit)).toBe(true);
    expect(second.output).toEqual(expectedWalk());
    expect(second.state.installs).toBe(1);
    expect(existsSync(path)).toBe(true);
  });

  it("setup fails when the helper binary is missing", async () => {
    // Given: CLOCKTRACE_HELPER points at a path that does not exist
    // When
    const { exit, output, state } = await run(
      Helper.Default,
      { installed: false, running: false, plist: null, installs: 0 },
      "/nope/clocktrace-helper",
    );
    // Then
    expect(exit).toEqual(
      Exit.fail(new HelperNotFoundError({ path: "/nope/clocktrace-helper" })),
    );
    expect(existsSync(path)).toBe(false);
    expect(state.installs).toBe(0);
    expect(output).toEqual([]);
  });

  it("no host found prints the four commands and exits 0", async () => {
    // Given: no host on PATH and no host config dir (HOME is empty)
    // When
    const { exit, output } = await run(
      helperStub(allGranted),
      { installed: true, running: true, plist: null, installs: 0 },
      "/stub",
      { answers: [""], interactive: true },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual(expect.arrayContaining(manualLines));
    expect(output.filter((l) => l.startsWith("1. ["))).toEqual([]);
  });

  it("non-tty without --hosts prints the four commands", async () => {
    // Given: fakePrompt interactive: false; no hosts argument
    // When
    const { exit, output, questions } = await run(helperStub(allGranted), {
      installed: true,
      running: true,
      plist: null,
      installs: 0,
    });
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual(expect.arrayContaining(manualLines));
    expect(questions).toEqual([]);
  });

  it("non-tty with --hosts registers the named without a checklist", async () => {
    // Given: fakePrompt interactive: false; hosts = claude, codex
    // When
    const { exit, output, questions } = await run(
      helperStub(allGranted),
      { installed: true, running: true, plist: null, installs: 0 },
      "/stub",
      { hosts: ["claude", "codex"], interactive: false },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toContain("claude code: registered");
    expect(output).toContain("codex: registered");
    expect(questions).toEqual([]);
  });
});
