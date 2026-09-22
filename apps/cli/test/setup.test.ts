import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  App,
  AppError,
  appMainPath,
  appPath,
  entryPath,
  fakeLaunchd,
  Helper,
  HelperNotFoundError,
  LaunchdError,
  type LaunchdState,
  type Permissions,
  plistPath,
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
  Schedule,
  Sink,
  Stream,
} from "effect";
import { NodeInspectSymbol } from "effect/Inspectable";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Style } from "../src/format.js";
import {
  type HostName,
  Hosts,
  hostLabel,
  hostNames,
  manualCommand,
} from "../src/hosts.js";
import { Prompt, Stdin } from "../src/prompt.js";
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
  Layer.succeed(
    Helper,
    new Helper({
      check: () => Effect.void,
      lines: () => Stream.empty,
      permissions: () => Effect.succeed(p),
      request: () => Effect.succeed("asked"),
      biomeDevices: () => Effect.succeed([]),
      biomeRecords: () => Effect.succeed([]),
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

// Tracks how many bundles were written; isInstalled flips true after
// the first install, like the real app on disk.
const fakeApp = (installs: Ref.Ref<number>) =>
  Layer.succeed(
    App,
    new App({
      isInstalled: () => Effect.map(Ref.get(installs), (n) => n > 0),
      install: () =>
        Ref.update(installs, (n) => n + 1).pipe(
          Effect.as("written" as const),
        ),
    }),
  );

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
      readonly keys?: ReadonlyArray<Key>;
      readonly interactive?: boolean;
      readonly stdin?: boolean;
      readonly launchd?: {
        readonly failBootstrap?: boolean;
        readonly bootstrapStuck?: boolean;
        readonly stalledSamples?: number;
      };
      readonly app?: Layer.Layer<App>;
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
        const state = yield* Ref.make(launchdState);
        const appInstalls = yield* Ref.make(0);
        const layers = Layer.mergeAll(
          Console.setConsole(console),
          NodeContext.layer,
          terminal.layer,
          Prompt.Default,
          (opts.stdin ?? true)
            ? Stdin.Test
            : Layer.succeed(Stdin, new Stdin({ isTTY: Effect.succeed(false) })),
          fakeLaunchd(state, opts.launchd),
          helperLayer,
          opts.app ?? fakeApp(appInstalls),
          Hosts.Default,
          noCommandsLayer,
          Style.Test,
        );
        const exit = yield* Effect.exit(
          setup(opts.hosts, Schedule.recurs(3)).pipe(Effect.provide(layers)),
        );
        return {
          exit,
          output: yield* console.getLines({ stripAnsi: true }),
          shown: yield* terminal.shown,
          state: yield* Ref.get(state),
          appInstalls: yield* Ref.get(appInstalls),
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
    "no terminal, skipping questions",
    "accessibility: window titles",
    "  denied: window titles are not tracked",
    "accessibility: granted",
    "full disk access: iPhone and iPad import",
    "  denied: iPhone and iPad time is not imported",
    "full disk access: granted",
    "Collector      ✔ running",
    "Permissions    2 of 2 granted",
    "  ✔ Accessibility     window titles",
    "  ✔ Full Disk Access  iPhone and iPad import",
    "Last activity  none yet",
    `Database       ${path}`,
    ...manualLines,
  ];

  it("setup writes the app, installs the Collector, walks the permissions, and prints the manual commands", async () => {
    // Given: no plist and no database file
    // When
    const { exit, output, state, appInstalls } = await run(
      helperStub(allGranted),
      {
        installed: false,
        running: false,
        plist: null,
        installs: 0,
      },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual([
      `app: written ${appPath}`,
      `launchd agent: written ${plistPath}`,
      ...expectedWalk(),
    ]);
    expect(appInstalls).toBe(1);
    expect(existsSync(path)).toBe(true);
    expect(state.installed).toBe(true);
    expect(state.running).toBe(true);
    expect(state.installs).toBe(1);
    expect(state.plist).toContain(`<string>${appMainPath}</string>`);
    expect(state.plist).toContain("<string>spawn</string>");
    expect(state.plist).toContain(`<string>${process.execPath}</string>`);
    expect(state.plist).toContain(`<string>${entryPath}</string>`);
    expect(state.plist).toContain(`<string>${path}</string>`);
    expect(state.plist).toContain("<string>/stub</string>");
  });

  it("setup again rewrites the app and the agent and walks the permissions", async () => {
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
    expect(second.output).toEqual([
      `app: written ${appPath}`,
      `launchd agent: written ${plistPath}`,
      ...expectedWalk(),
    ]);
    expect(second.state.installs).toBe(2);
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

  it("enter with nothing ticked prints no host picked and the four commands", async () => {
    // Given: no host on PATH and no host config dir (HOME is empty)
    // When: enter submits the checklist untouched
    const { exit, output, shown } = await run(
      helperStub(allGranted),
      { installed: true, running: true, plist: null, installs: 0 },
      "/stub",
      { keys: [{ key: "enter" }], interactive: true },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(shown).toContain("  ☐ Claude Code");
    expect(output).toContain("no host picked");
    expect(output).toEqual(expect.arrayContaining(manualLines));
    expect(output.every((l) => !l.endsWith("registered"))).toBe(true);
  });

  it("non-tty without --hosts prints no terminal once and the four commands", async () => {
    // Given: the mock terminal is not a TTY; no hosts argument
    // When
    const { exit, output, shown } = await run(helperStub(allGranted), {
      installed: true,
      running: true,
      plist: null,
      installs: 0,
    });
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(
      output.filter((l) => l === "no terminal, skipping questions"),
    ).toHaveLength(1);
    expect(output).toEqual(expect.arrayContaining(manualLines));
    expect(output).not.toContain("no host picked");
    expect(shown).not.toContain("Hosts");
  });

  it("tty stdout with non-tty stdin prints no terminal once and the four commands", async () => {
    // Given: the mock terminal is a TTY but stdin is not
    // When
    const { exit, output, shown } = await run(
      helperStub(allGranted),
      { installed: true, running: true, plist: null, installs: 0 },
      "/stub",
      { interactive: true, stdin: false },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(
      output.filter((l) => l === "no terminal, skipping questions"),
    ).toHaveLength(1);
    expect(output).toEqual(expect.arrayContaining(manualLines));
    expect(output).not.toContain("no host picked");
    expect(shown).not.toContain("Hosts");
  });

  it("setup rewrites and reloads the agent on a re-run", async () => {
    // Given: the plist present but the Collector not loaded
    const { exit, state } = await run(helperStub(allGranted), {
      installed: true,
      running: false,
      plist: "<plist>",
      installs: 1,
    });
    // Then: the re-run rewrites the agent and loads the Collector
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(state.running).toBe(true);
    expect(state.installs).toBe(2);
    expect(state.plist).toContain("<string>spawn</string>");
  });

  it("setup fails loudly when the load step fails", async () => {
    // Given: the plist present, not loaded, and the load step fails
    const { exit, output, state } = await run(
      helperStub(allGranted),
      { installed: true, running: false, plist: "<plist>", installs: 1 },
      "/stub",
      { launchd: { failBootstrap: true } },
    );
    // Then: it fails with the launchd error and never reaches the agent
    expect(exit).toEqual(
      Exit.fail(
        new LaunchdError({ step: "launchctl bootstrap", detail: "exit 1" }),
      ),
    );
    expect(output).toEqual([`app: written ${appPath}`]);
    expect(state.installs).toBe(1);
  });

  it("setup fails when the load reports success but the Collector stays stopped", async () => {
    // Given: the plist present, not loaded; the load returns success but the
    // Collector never comes up (launchctl bootstrap exit 5 on a bad plist)
    const { exit, output, state } = await run(
      helperStub(allGranted),
      { installed: true, running: false, plist: "<plist>", installs: 1 },
      "/stub",
      { launchd: { bootstrapStuck: true } },
    );
    // Then: setup fails loudly and removes the plist that never started
    expect(exit).toEqual(
      Exit.fail(
        new LaunchdError({
          step: "launchctl bootstrap",
          detail: "collector did not start",
        }),
      ),
    );
    expect(output).toEqual([
      `app: written ${appPath}`,
      `launchd agent: written ${plistPath}`,
    ]);
    expect(state.plist).toBe(null);
    expect(state.installed).toBe(false);
  });

  it("setup tolerates a slow startup and then succeeds", async () => {
    // Given: the load returns success and the Collector reaches running only
    // after two stopped samples (RunAtLoad startup latency)
    const { exit } = await run(
      helperStub(allGranted),
      { installed: true, running: false, plist: "<plist>", installs: 1 },
      "/stub",
      { launchd: { stalledSamples: 2 } },
    );
    // Then: the bounded poll waits it out instead of failing
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("a fresh load that never starts removes the plist", async () => {
    // Given: no plist beforehand; the fresh load returns success (bootstrap
    // exit 5) but the Collector never reaches running
    const { exit, state } = await run(
      helperStub(allGranted),
      { installed: false, running: false, plist: null, installs: 0 },
      "/stub",
      { launchd: { bootstrapStuck: true } },
    );
    // Then: setup fails and clears the plist it just wrote
    expect(exit).toEqual(
      Exit.fail(
        new LaunchdError({
          step: "launchctl bootstrap",
          detail: "collector did not start",
        }),
      ),
    );
    expect(state.plist).toBe(null);
    expect(state.installed).toBe(false);
  });

  it("a failed fresh install leaves no plist", async () => {
    // Given: no plist beforehand and the load step fails
    const { exit, state } = await run(
      helperStub(allGranted),
      { installed: false, running: false, plist: null, installs: 0 },
      "/stub",
      { launchd: { failBootstrap: true } },
    );
    // Then: the failed install leaves no plist behind
    expect(exit).toEqual(
      Exit.fail(
        new LaunchdError({ step: "launchctl bootstrap", detail: "exit 1" }),
      ),
    );
    expect(state.plist).toBe(null);
    expect(state.installs).toBe(0);
  });

  it("a failed app install stops setup before the agent", async () => {
    // Given: the app install fails at codesign; no plist
    const appFails = Layer.succeed(
      App,
      new App({
        isInstalled: () => Effect.succeed(false),
        install: () =>
          Effect.fail(
            new AppError({ step: "codesign", detail: "exit 1" }),
          ),
      }),
    );
    // When
    const { exit, output, state } = await run(
      helperStub(allGranted),
      { installed: false, running: false, plist: null, installs: 0 },
      "/stub",
      { app: appFails },
    );
    // Then
    expect(exit).toEqual(
      Exit.fail(new AppError({ step: "codesign", detail: "exit 1" })),
    );
    expect(state.installs).toBe(0);
    expect(output).toEqual([]);
  });

  it("--hosts on a terminal registers the named without a checklist", async () => {
    // Given: a TTY and hosts = claude, codex
    // When
    const { exit, output, shown } = await run(
      helperStub(allGranted),
      { installed: true, running: true, plist: null, installs: 0 },
      "/stub",
      { hosts: ["claude", "codex"], interactive: true },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toContain("claude code: registered");
    expect(output).toContain("codex: registered");
    expect(shown).not.toContain("Hosts");
  });

  it("non-tty with --hosts registers the named without a checklist", async () => {
    // Given: the mock terminal is not a TTY; hosts = claude, codex
    // When
    const { exit, output, shown } = await run(
      helperStub(allGranted),
      { installed: true, running: true, plist: null, installs: 0 },
      "/stub",
      { hosts: ["claude", "codex"], interactive: false },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toContain("claude code: registered");
    expect(output).toContain("codex: registered");
    expect(shown).not.toContain("Hosts");
  });
});
