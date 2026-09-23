import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  App,
  CollectorNotLoadedError,
  CollectorPaths,
  type CollectorSettings,
  Helper,
  HelperNotFoundError,
  type InstallProgress,
  LaunchdError,
  Lifecycle,
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
  hostLabel,
  hostNames,
  manualCommand,
} from "../src/hosts.js";
import { ReportedError } from "../src/output.js";
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

const helperStub = (...ps: ReadonlyArray<Permissions>) =>
  Layer.unwrapEffect(
    Effect.map(Ref.make(ps), (answers) =>
      Helper.Test({
        permissions: () =>
          Ref.modify(answers, (as) => {
            const head = as[0] ?? as.at(-1);
            if (head === undefined) {
              throw new Error("no permission answers left");
            }
            return [head, as.length > 1 ? as.slice(1) : as];
          }),
      }),
    ),
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

// No command runs for real: exitCode says 1 and a started process exits 0.
const noCommandsLayer = Layer.succeed(CommandExecutor.CommandExecutor, {
  [CommandExecutor.TypeId]: CommandExecutor.TypeId,
  exitCode: () => Effect.succeed(1 as CommandExecutor.ExitCode),
  start: (_command: Command.Command) => Effect.succeed(fakeProcess(0)),
  string: () => Effect.succeed(""),
  lines: () => Effect.succeed([]),
  stream: () => Stream.empty,
  streamLines: () => Stream.empty,
} satisfies CommandExecutor.CommandExecutor);

// How the fake Lifecycle ends: loaded, failed reading the old plist
// before the App step, or not loaded at the bootout of the old agent, at
// the agent step, or while it waits for the start.
type Outcome =
  | "loaded"
  | { readonly failAt: "read" }
  | {
      readonly failAt: "bootout" | "agent" | "start";
      readonly appRestored: boolean;
      readonly agentRestored: boolean;
    };

const bootoutError = new LaunchdError({
  step: "launchctl bootout",
  detail: "exit 5",
  log: "/Users/me/Library/Logs/clocktrace/collector.log",
});

const readError = new LaunchdError({
  step: "read /Users/me/Library/LaunchAgents/com.clocktrace.collector.plist",
  detail: "EACCES: permission denied",
});

// Reports progress as the real install does and keeps the settings of
// every call.
const fakeLifecycle = (
  outcome: Outcome,
  installs: Ref.Ref<ReadonlyArray<CollectorSettings>>,
) =>
  Layer.succeed(
    Lifecycle,
    new Lifecycle({
      install: <R>(settings: CollectorSettings, progress: InstallProgress<R>) =>
        Effect.gen(function* () {
          yield* Ref.update(installs, (all) => [...all, settings]);
          if (outcome !== "loaded" && outcome.failAt === "read") {
            return yield* readError;
          }
          yield* progress.done("app");
          if (outcome !== "loaded" && outcome.failAt === "bootout") {
            return yield* new CollectorNotLoadedError({
              cause: bootoutError,
              appRestored: outcome.appRestored,
              agentRestored: outcome.agentRestored,
            });
          }
          if (outcome !== "loaded" && outcome.failAt === "agent") {
            return yield* new CollectorNotLoadedError({
              cause: new LaunchdError({
                step: "launchctl bootstrap",
                detail: "exit 1",
              }),
              appRestored: outcome.appRestored,
              agentRestored: outcome.agentRestored,
            });
          }
          yield* progress.done("agent");
          yield* progress.starting(Effect.void);
          if (outcome !== "loaded") {
            return yield* new CollectorNotLoadedError({
              cause: new LaunchdError({
                step: "launchctl bootstrap",
                detail: "collector did not start",
              }),
              appRestored: outcome.appRestored,
              agentRestored: outcome.agentRestored,
            });
          }
          return "loaded" as const;
        }),
      settings: () => Effect.succeed(null),
      databasePath: () => Effect.die("setup does not read the database path"),
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
    outcome: Outcome = "loaded",
    helperPath = "/stub",
    opts: {
      readonly hosts?: ReadonlyArray<HostName>;
      readonly keys?: ReadonlyArray<Key>;
      readonly interactive?: boolean;
      readonly stdin?: boolean;
      readonly hostLayer?: Layer.Layer<Hosts>;
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
        const installs = yield* Ref.make<ReadonlyArray<CollectorSettings>>([]);
        const layers = Layer.mergeAll(
          Console.setConsole(console),
          NodeContext.layer,
          terminal.layer,
          Prompt.Default,
          (opts.stdin ?? true)
            ? Stdin.Test
            : Layer.succeed(Stdin, new Stdin({ isTTY: Effect.succeed(false) })),
          fakeLifecycle(outcome, installs),
          helperLayer,
          App.Test,
          opts.hostLayer ?? Hosts.Test(),
          noCommandsLayer,
          Style.Test,
          CollectorPaths.Default(home),
        );
        const exit = yield* Effect.exit(
          setup(opts.hosts).pipe(Effect.provide(layers)),
        );
        return {
          exit,
          output: yield* console.getLines({ stripAnsi: true }),
          shown: yield* terminal.shown,
          installs: yield* Ref.get(installs),
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

  const expectedSetup = () => [
    "Collector",
    "  ✔ app           ~/Applications/Clocktrace.app",
    "  ✔ launch agent  ~/Library/LaunchAgents/com.clocktrace.collector.plist",
    "  starting collector…",
    "  ✔ running",
    "Permissions   2 of 3 granted",
    "  ✔ Accessibility     window titles",
    "  ✔ Full Disk Access  iPhone and iPad import",
    "  ○ Automation  no browser used yet",
    "no terminal, skipping questions",
    ...manualLines,
    "",
    `Done. Database at ${path}. Run clocktrace status any time.`,
  ];

  it("setup writes the app, installs the Collector, walks the permissions, and prints the manual commands", async () => {
    // Given: no plist and no database file
    // When
    const { exit, output, installs } = await run(helperStub(allGranted));
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual(expectedSetup());
    expect(existsSync(path)).toBe(true);
    expect(installs).toEqual([{ helperPath: "/stub", databasePath: path }]);
  });

  it("setup fails when the helper binary is missing", async () => {
    // Given: CLOCKTRACE_HELPER points at a path that does not exist
    // When
    const { exit, output, installs } = await run(
      Helper.Default,
      "loaded",
      "/nope/clocktrace-helper",
    );
    // Then
    expect(exit).toEqual(
      Exit.fail(new HelperNotFoundError({ path: "/nope/clocktrace-helper" })),
    );
    expect(existsSync(path)).toBe(false);
    expect(installs).toEqual([]);
    expect(output).toEqual([]);
  });

  it("enter with nothing ticked prints no host picked and the four commands", async () => {
    // Given: no host on PATH and no host config dir (HOME is empty)
    // When: enter submits the checklist untouched
    const { exit, output, shown } = await run(
      helperStub(allGranted),
      "loaded",
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
    const { exit, output, shown } = await run(helperStub(allGranted), "loaded");
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
      "loaded",
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

  it("a load that fails prints the app row and the log path", async () => {
    // Given: the Collector does not load at the agent step
    // When
    const { exit, output } = await run(helperStub(allGranted), {
      failAt: "agent",
      appRestored: true,
      agentRestored: true,
    });
    // Then: the launchd error is reported with the collector log
    expect(exit).toEqual(
      Exit.fail(
        new ReportedError({
          cause: new LaunchdError({
            step: "launchctl bootstrap",
            detail: "exit 1",
          }),
        }),
      ),
    );
    expect(output).toEqual([
      "Collector",
      "  ✔ app           ~/Applications/Clocktrace.app",
      "  ✘ collector did not start · see ~/Library/Logs/clocktrace/collector.log",
    ]);
  });

  it("a plist that cannot be read fails before the app row", async () => {
    // Given: the old plist cannot be read
    // When
    const { exit, output } = await run(helperStub(allGranted), {
      failAt: "read",
    });
    // Then: the read error goes out whole and no row is printed
    expect(exit).toEqual(Exit.fail(readError));
    expect(output).toEqual(["Collector"]);
  });

  it("a bootout that fails prints its cause", async () => {
    // Given: the old agent cannot be booted out; the old App came back
    // When
    const { exit, output } = await run(helperStub(allGranted), {
      failAt: "bootout",
      appRestored: true,
      agentRestored: true,
    });
    // Then: the bootout cause, not a start failure, and no restore line
    expect(exit).toEqual(Exit.fail(new ReportedError({ cause: bootoutError })));
    expect(output).toEqual([
      "Collector",
      "  ✔ app           ~/Applications/Clocktrace.app",
      "  ✘ launchctl bootout: exit 5",
    ]);
  });

  it("a start that never comes prints starting and the log path", async () => {
    // Given: the Collector never reaches Loaded
    // When
    const { exit, output } = await run(helperStub(allGranted), {
      failAt: "start",
      appRestored: true,
      agentRestored: true,
    });
    // Then
    expect(exit).toEqual(
      Exit.fail(
        new ReportedError({
          cause: new LaunchdError({
            step: "launchctl bootstrap",
            detail: "collector did not start",
          }),
        }),
      ),
    );
    expect(output).toEqual([
      "Collector",
      "  ✔ app           ~/Applications/Clocktrace.app",
      "  ✔ launch agent  ~/Library/LaunchAgents/com.clocktrace.collector.plist",
      "  starting collector…",
      "  ✘ collector did not start · see ~/Library/Logs/clocktrace/collector.log",
    ]);
  });

  it("an App that cannot be put back says so before the failure", async () => {
    // Given: the Collector never reaches Loaded and the old App stays gone
    // When
    const { output } = await run(helperStub(allGranted), {
      failAt: "start",
      appRestored: false,
      agentRestored: true,
    });
    // Then: the restore line comes right before the failure line
    const failure = output.indexOf(
      "  ✘ collector did not start · see ~/Library/Logs/clocktrace/collector.log",
    );
    expect(failure).toBeGreaterThan(0);
    expect(output[failure - 1]).toBe(
      "app: could not restore the previous install",
    );
  });

  it("an agent that cannot be put back says so before the failure", async () => {
    // Given: the Collector never reaches Loaded and the old agent stays gone
    // When
    const { output } = await run(helperStub(allGranted), {
      failAt: "start",
      appRestored: true,
      agentRestored: false,
    });
    // Then: the restore line comes right before the failure line
    const failure = output.indexOf(
      "  ✘ collector did not start · see ~/Library/Logs/clocktrace/collector.log",
    );
    expect(failure).toBeGreaterThan(0);
    expect(output[failure - 1]).toBe(
      "launch agent: could not restore the previous install",
    );
  });

  it("setup loads the Collector before the permissions walk and the Hosts", async () => {
    // Given: a TTY and hosts = claude
    // When
    const { exit, output } = await run(
      helperStub(allGranted),
      "loaded",
      "/stub",
      { hosts: ["claude"], interactive: true },
    );
    // Then: running, then the Permissions header, then the Host
    expect(Exit.isSuccess(exit)).toBe(true);
    const running = output.indexOf("  ✔ running");
    const permissions = output.findIndex((l) => l.startsWith("Permissions"));
    const registered = output.indexOf("  ✔ Claude Code registered");
    expect(running).toBeGreaterThanOrEqual(0);
    expect(running).toBeLessThan(permissions);
    expect(permissions).toBeLessThan(registered);
  });

  it("--hosts on a terminal registers the named without a checklist", async () => {
    // Given: a TTY and hosts = claude, codex
    // When
    const { exit, output, shown } = await run(
      helperStub(allGranted),
      "loaded",
      "/stub",
      { hosts: ["claude", "codex"], interactive: true },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toContain("  ✔ Claude Code registered");
    expect(output).toContain("  ✔ Codex registered");
    expect(shown).not.toContain("Hosts");
  });

  it("non-tty with --hosts registers the named without a checklist", async () => {
    // Given: the mock terminal is not a TTY; hosts = claude, codex
    // When
    const { exit, output, shown } = await run(
      helperStub(allGranted),
      "loaded",
      "/stub",
      { hosts: ["claude", "codex"], interactive: false },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toContain("  ✔ Claude Code registered");
    expect(output).toContain("  ✔ Codex registered");
    expect(shown).not.toContain("Hosts");
  });

  // Claude Code is found; each register is recorded and succeeds.
  const recordingHosts = (calls: Ref.Ref<ReadonlyArray<HostName>>) =>
    Hosts.Test({
      detect: () =>
        Effect.succeed({
          claude: true,
          codex: false,
          hermes: false,
          openclaw: false,
        }),
      register: (host) =>
        Ref.update(calls, (c) => [...c, host]).pipe(
          Effect.as({ outcome: "registered" } as const),
        ),
    });

  it("the checklist registers the ticked hosts", async () => {
    // Given: Claude Code found, the others not
    const calls = Effect.runSync(Ref.make<ReadonlyArray<HostName>>([]));
    // When: down to Codex, space ticks it, enter registers claude and codex
    const { exit, output, shown } = await run(
      helperStub(allGranted),
      "loaded",
      "/stub",
      {
        keys: [
          { key: "down" },
          { key: "down" },
          { key: "down" },
          { key: "space" },
          { key: "enter" },
        ],
        interactive: true,
        hostLayer: recordingHosts(calls),
      },
    );
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
    expect(Effect.runSync(Ref.get(calls))).toEqual(["claude", "codex"]);
    expect(output).toContain("  ✔ Claude Code registered");
    expect(output).toContain("  ✔ Codex registered");
  });

  it("ctrl-c at the checklist stops setup and registers nothing", async () => {
    // Given: Claude Code found; ctrl-c arrives at the checklist
    const calls = Effect.runSync(Ref.make<ReadonlyArray<HostName>>([]));
    // When
    const { exit, output } = await run(
      helperStub(allGranted),
      "loaded",
      "/stub",
      {
        keys: [{ key: "c", ctrl: true }],
        interactive: true,
        hostLayer: recordingHosts(calls),
      },
    );
    // Then
    expect(exit).toEqual(Exit.fail(new StoppedError()));
    expect(Effect.runSync(Ref.get(calls))).toEqual([]);
    expect(output.every((line) => !line.endsWith("registered"))).toBe(true);
  });

  it("a key other than arrows, space, enter does nothing at the checklist", async () => {
    // Given: Claude Code found; an unrelated key, then enter
    const calls = Effect.runSync(Ref.make<ReadonlyArray<HostName>>([]));
    // When
    const { exit, output, shown } = await run(
      helperStub(allGranted),
      "loaded",
      "/stub",
      {
        keys: ["x", { key: "enter" }],
        interactive: true,
        hostLayer: recordingHosts(calls),
      },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(shown.split("Inverse Selection")).toHaveLength(2);
    expect(output).toContain("  ✔ Claude Code registered");
  });

  it("a failed add prints the ✘ line with the manual command", async () => {
    // Given: not a TTY; the Codex add fails
    // When
    const { exit, output } = await run(
      helperStub(allGranted),
      "loaded",
      "/stub",
      {
        hosts: ["codex"],
        interactive: false,
        hostLayer: Hosts.Test({
          register: () =>
            Effect.succeed({ outcome: "failed", byHand: manualCommand.codex }),
        }),
      },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toContain(
      `  ✘ Codex failed · run by hand: ${manualCommand.codex}`,
    );
  });
});
