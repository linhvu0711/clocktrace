import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  App,
  CollectorPaths,
  collectorPaths,
  collectorPlist,
  defaultDbPath,
  fakeLaunchd,
  Launchd,
  LaunchdError,
  type LaunchdState,
} from "@clocktrace/collector";
import { NodeContext } from "@effect/platform-node";
import { ConfigProvider, Console, Effect, Exit, Layer, Ref } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Style } from "../src/format.js";
import type { UnregisterOutcome } from "../src/host.js";
import {
  type HostName,
  HostRemoveError,
  Hosts,
  manualRemoveCommand,
} from "../src/hosts.js";
import { ReportedError } from "../src/output.js";
import { Prompt, Stdin } from "../src/prompt.js";
import { purgeTargets, uninstall } from "../src/uninstall.js";
import * as MockConsole from "./mock-console.js";
import { type ExecResult, fakeExecutor } from "./mock-executor.js";
import * as MockTerminal from "./mock-terminal.js";

type Key = { readonly key: string; readonly ctrl?: boolean } | string;

const installedAgent: LaunchdState = {
  installed: true,
  running: true,
  plist: "<plist>",
  installs: 1,
};

const noAgent: LaunchdState = {
  installed: false,
  running: false,
  plist: null,
  installs: 0,
};

// The bundle is a flag: remove clears it and reports what it found, and
// leaves a marker in the executor's record so its order can be checked.
const fakeApp = (
  present: Ref.Ref<boolean>,
  recorded: Ref.Ref<ReadonlyArray<string>>,
) =>
  Layer.succeed(
    App,
    new App({
      isInstalled: () => Ref.get(present),
      install: () => Ref.set(present, true).pipe(Effect.as("written" as const)),
      commit: () => Effect.void,
      rollback: () => Effect.void,
      remove: () =>
        Ref.update(recorded, (r) => [...r, "app.remove"]).pipe(
          Effect.andThen(Ref.getAndSet(present, false)),
          Effect.map((was) =>
            was ? ("removed" as const) : ("absent" as const),
          ),
        ),
    }),
  );

const bootoutFails = (state: Ref.Ref<LaunchdState>) =>
  Layer.effect(
    Launchd,
    Effect.map(
      Launchd,
      (base) =>
        new Launchd({
          ...base,
          uninstall: () =>
            Effect.fail(
              new LaunchdError({ step: "launchctl bootout", detail: "exit 1" }),
            ),
        }),
    ),
  ).pipe(Layer.provide(fakeLaunchd(state)));

// A Hosts that finds the named Hosts and answers each unregister with
// `unregister`.
const hostsFinding = (
  found: ReadonlyArray<HostName>,
  unregister: (
    host: HostName,
  ) => Effect.Effect<UnregisterOutcome, HostRemoveError>,
) =>
  Hosts.Test({
    detect: () =>
      Effect.succeed({
        claude: found.includes("claude"),
        codex: found.includes("codex"),
        hermes: found.includes("hermes"),
        openclaw: found.includes("openclaw"),
      }),
    unregister,
  });

const tccReset = { "tccutil reset All com.clocktrace.app": { code: 0 } };

describe("uninstall", () => {
  let dir: string;
  let home: string;
  let dbPath: string;
  let logDir: string;
  let appPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clocktrace-"));
    home = mkdtempSync(join(tmpdir(), "clocktrace-home-"));
    dbPath = join(dir, "clocktrace.db");
    logDir = collectorPaths(home).logDir;
    appPath = collectorPaths(home).appPath;
    vi.stubEnv("HOME", home);
  });

  // The plist setup would write for a database at `databasePath`.
  const plistFor = (databasePath: string) =>
    collectorPlist({
      app: join(appPath, "Contents", "MacOS", "Clocktrace"),
      node: "/usr/local/bin/node",
      entry: "/repo/main.js",
      databasePath,
      helperPath: "/stub",
      logPath: collectorPaths(home).logPath,
    });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  const writeState = () => {
    writeFileSync(dbPath, "db");
    writeFileSync(`${dbPath}-wal`, "wal");
    writeFileSync(`${dbPath}-shm`, "shm");
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, "collector.log"), "log");
  };

  const run = (opts: {
    readonly purge?: boolean;
    readonly agent?: LaunchdState;
    readonly app?: boolean;
    readonly results?: Record<string, ExecResult>;
    readonly interactive?: boolean;
    readonly keys?: ReadonlyArray<Key>;
    readonly launchd?: (state: Ref.Ref<LaunchdState>) => Layer.Layer<Launchd>;
    /** The CLOCKTRACE_DB env var; null leaves it unset. */
    readonly db?: string | null;
    /** A bundle folder on disk without its executable. */
    readonly damaged?: boolean;
    readonly hostLayer?: Layer.Layer<Hosts>;
  }) =>
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
        const state = yield* Ref.make(opts.agent ?? installedAgent);
        const appPresent = yield* Ref.make(opts.app ?? true);
        // The disk mirrors the fake: the bundle folder exists when the
        // app is present or damaged, the executable only when present.
        if ((opts.app ?? true) || opts.damaged) {
          mkdirSync(join(appPath, "Contents", "MacOS"), { recursive: true });
        }
        if (opts.app ?? true) {
          writeFileSync(join(appPath, "Contents", "MacOS", "Clocktrace"), "x");
        }
        const layers = Layer.mergeAll(
          Console.setConsole(console),
          NodeContext.layer,
          terminal.layer,
          Prompt.Default,
          Stdin.Test,
          (opts.launchd ?? fakeLaunchd)(state),
          fakeApp(appPresent, executor.recorded),
          opts.hostLayer ?? Hosts.Test(),
          executor.layer,
          Style.Test,
          CollectorPaths.Default(home),
        );
        const exit = yield* Effect.exit(
          uninstall({ purge: opts.purge ?? false }).pipe(
            Effect.provide(layers),
          ),
        );
        return {
          exit,
          output: yield* console.getLines({ stripAnsi: true }),
          shown: yield* terminal.shown,
          recorded: yield* Ref.get(executor.recorded),
          state: yield* Ref.get(state),
          appPresent: yield* Ref.get(appPresent),
        };
      }).pipe(
        Effect.withConfigProvider(
          ConfigProvider.fromMap(
            new Map(
              opts.db === null ? [] : [["CLOCKTRACE_DB", opts.db ?? dbPath]],
            ),
          ),
        ),
      ),
    );

  it("removes the agent, the app, and the host entry, and resets the grants", async () => {
    // Given: agent loaded, app present, Claude Code found and removed,
    // tccutil ok
    writeState();
    // When
    const { exit, output, recorded, state, appPresent } = await run({
      results: tccReset,
      hostLayer: hostsFinding(["claude"], () => Effect.succeed("unregistered")),
    });
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual([
      "✔ launch agent removed",
      "✔ permissions reset",
      "✔ app removed",
      "✔ Claude Code unregistered",
      "",
      `Done. Database kept at ${dbPath} (CLOCKTRACE_DB='${dbPath}' clocktrace uninstall --purge deletes it).`,
    ]);
    expect(state.installed).toBe(false);
    expect(state.running).toBe(false);
    expect(appPresent).toBe(false);
    // The grants are reset while Launch Services still knows the bundle
    expect(recorded.slice(0, 2)).toEqual([
      "tccutil reset All com.clocktrace.app",
      "app.remove",
    ]);
    expect(existsSync(dbPath)).toBe(true);
    expect(existsSync(join(logDir, "collector.log"))).toBe(true);
  });

  it("with nothing installed says already removed and exits 0, twice", async () => {
    // Given: no agent, no app, no hosts
    const expected = [
      "✔ launch agent already removed",
      "✔ app already removed",
      "○ no hosts found",
      "",
      `Done. Database kept at ${dbPath} (CLOCKTRACE_DB='${dbPath}' clocktrace uninstall --purge deletes it).`,
    ];
    // When
    const first = await run({ agent: noAgent, app: false });
    const second = await run({ agent: noAgent, app: false });
    // Then: no permissions line and no tccutil run, there is no app to reset
    expect(Exit.isSuccess(first.exit)).toBe(true);
    expect(first.output).toEqual(expected);
    expect(first.recorded).not.toContain(
      "tccutil reset All com.clocktrace.app",
    );
    expect(Exit.isSuccess(second.exit)).toBe(true);
    expect(second.output).toEqual(expected);
  });

  it("--purge without a terminal deletes the database, its side files, and the logs", async () => {
    // Given: the database with -wal and -shm, and a log file
    writeState();
    // When
    const { exit, output, shown } = await run({ purge: true });
    // Then: the three files and the log dir are gone; the custom folder stays
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(existsSync(dbPath)).toBe(false);
    expect(existsSync(`${dbPath}-wal`)).toBe(false);
    expect(existsSync(`${dbPath}-shm`)).toBe(false);
    expect(existsSync(logDir)).toBe(false);
    expect(existsSync(dir)).toBe(true);
    expect(shown).not.toContain("delete the database");
    expect(output).toContain("✔ database removed");
    expect(output).toContain("✔ logs removed");
    expect(output.at(-1)).toBe("Done. Only the clocktrace command remains.");
  });

  it("--purge on a terminal asks first; n keeps the database and still removes the logs", async () => {
    // Given: a TTY; the answer is n
    writeState();
    // When
    const { exit, output, shown } = await run({
      purge: true,
      interactive: true,
      keys: ["n"],
    });
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(shown).toContain(`delete the database at ${dbPath}?`);
    expect(existsSync(dbPath)).toBe(true);
    expect(existsSync(logDir)).toBe(false);
    expect(output).toContain("○ database kept");
    expect(output).toContain("✔ logs removed");
    expect(output.at(-1)).toBe(
      `Done. Database kept at ${dbPath} (CLOCKTRACE_DB='${dbPath}' clocktrace uninstall --purge deletes it).`,
    );
  });

  it("purgeTargets removes the folder only for the default path", () => {
    // Given: the default path and a custom one
    // When
    const atDefault = purgeTargets("/x/clocktrace.db", "/x/clocktrace.db");
    const custom = purgeTargets("/y/clocktrace.db", "/x/clocktrace.db");
    // Then
    expect(atDefault).toEqual({
      files: [
        "/x/clocktrace.db",
        "/x/clocktrace.db-wal",
        "/x/clocktrace.db-shm",
      ],
      dir: "/x",
    });
    expect(custom.dir).toBe(null);
  });

  it("prints the Hermes Agent line when its block is removed", async () => {
    // Given: Hermes Agent found; its unregister removes the block
    // When
    const { exit, output } = await run({
      hostLayer: hostsFinding(["hermes"], () => Effect.succeed("unregistered")),
    });
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toContain("✔ Hermes Agent unregistered");
  });

  it("a host remove that fails is reported, the rest still runs, and the exit is 1", async () => {
    // Given: Claude Code and Codex found; Claude Code's remove fails,
    // Codex's works; --purge without a terminal
    writeState();
    // When
    const { exit, output } = await run({
      purge: true,
      results: tccReset,
      hostLayer: hostsFinding(["claude", "codex"], (host) =>
        host === "claude"
          ? Effect.fail(new HostRemoveError({ host }))
          : Effect.succeed("unregistered"),
      ),
    });
    // Then: every step ran and the Done line is printed; the exit says 1
    expect(exit).toEqual(
      Exit.fail(
        new ReportedError({ cause: new HostRemoveError({ host: "claude" }) }),
      ),
    );
    expect(output).toEqual([
      "✔ launch agent removed",
      "✔ permissions reset",
      "✔ app removed",
      `✘ Claude Code failed · run by hand: ${manualRemoveCommand.claude}`,
      "✔ Codex unregistered",
      "✔ database removed",
      "✔ logs removed",
      "",
      "Done. Only the clocktrace command remains.",
    ]);
    expect(existsSync(dbPath)).toBe(false);
  });

  it("a host without the server is not registered, not an error", async () => {
    // Given: Claude Code found; it has no clocktrace server
    // When
    const { exit, output } = await run({
      results: tccReset,
      hostLayer: hostsFinding(["claude"], () =>
        Effect.succeed("not registered"),
      ),
    });
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toContain("✔ Claude Code not registered");
  });

  it("a host found by its config but not on PATH is a skip line with the manual command", async () => {
    // Given: Claude Code found by its config, its binary not on PATH
    // When
    const { exit, output } = await run({
      results: tccReset,
      hostLayer: hostsFinding(["claude"], () => Effect.succeed("no cli")),
    });
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toContain(
      `○ Claude Code: claude not on PATH · run by hand: ${manualRemoveCommand.claude}`,
    );
  });

  it("--purge takes the database path from the agent's plist when the env var is unset", async () => {
    // Given: the plist names a custom database; CLOCKTRACE_DB is not set
    const custom = join(dir, "custom.db");
    writeFileSync(custom, "db");
    const hadDefault = existsSync(defaultDbPath);
    // When
    const { exit, output } = await run({
      purge: true,
      db: null,
      agent: { ...installedAgent, plist: plistFor(custom) },
    });
    // Then: the plist's database is gone and the default one is untouched
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(existsSync(custom)).toBe(false);
    expect(existsSync(defaultDbPath)).toBe(hadDefault);
    expect(output).toContain("✔ database removed");
  });

  it("CLOCKTRACE_DB set for the run wins over the plist", async () => {
    // Given: the plist names one database, the env var another
    const fromPlist = join(dir, "plist.db");
    writeFileSync(fromPlist, "db");
    writeFileSync(dbPath, "db");
    // When
    const { exit, output } = await run({
      purge: true,
      agent: { ...installedAgent, plist: plistFor(fromPlist) },
    });
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(existsSync(dbPath)).toBe(false);
    expect(existsSync(fromPlist)).toBe(true);
    expect(output.at(-1)).toBe("Done. Only the clocktrace command remains.");
  });

  it("the Done line names the database the plist pointed at and the command that purges it later", async () => {
    // Given: no env var; the plist names a custom database; no --purge
    const custom = join(dir, "custom.db");
    // When
    const { exit, output } = await run({
      db: null,
      agent: { ...installedAgent, plist: plistFor(custom) },
    });
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output.at(-1)).toBe(
      `Done. Database kept at ${custom} (CLOCKTRACE_DB='${custom}' clocktrace uninstall --purge deletes it).`,
    );
  });

  it("a bundle without its executable still gets its grants reset", async () => {
    // Given: the bundle folder exists but the executable is gone
    // When
    const { exit, output, recorded } = await run({
      app: false,
      damaged: true,
      results: tccReset,
    });
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(recorded).toContain("tccutil reset All com.clocktrace.app");
    expect(output).toContain("✔ permissions reset");
  });

  it("a failed tccutil is a skip line, not an error", async () => {
    // Given: the app present; tccutil not listed, so it exits 1
    // When
    const { exit, output } = await run({});
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toContain(
      "○ permissions not reset · remove Clocktrace under System Settings › Privacy & Security",
    );
  });

  it("a failed bootout stops before the app", async () => {
    // Given: launchctl bootout exits 1
    // When
    const { exit, output, appPresent } = await run({ launchd: bootoutFails });
    // Then
    expect(exit).toEqual(
      Exit.fail(
        new ReportedError({
          cause: new LaunchdError({
            step: "launchctl bootout",
            detail: "exit 1",
          }),
        }),
      ),
    );
    expect(output).toEqual([
      "✘ launchctl bootout: exit 1",
      "  log  ~/Library/Logs/clocktrace/collector.log",
    ]);
    expect(appPresent).toBe(true);
  });
});
