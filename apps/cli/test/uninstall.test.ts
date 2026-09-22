import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  App,
  fakeLaunchd,
  Launchd,
  LaunchdError,
  type LaunchdState,
  logPath,
} from "@clocktrace/collector";
import { NodeContext } from "@effect/platform-node";
import { ConfigProvider, Console, Effect, Exit, Layer, Ref } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

import { Style } from "../src/format.js";
import { HostRemoveError, Hosts } from "../src/hosts.js";
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

const claudeFound = { "which claude": { code: 0 } };
const claudeRemoved = {
  "claude mcp remove clocktrace --scope user": { code: 0 },
};
const tccReset = { "tccutil reset All com.clocktrace.app": { code: 0 } };

describe("uninstall", () => {
  let dir: string;
  let home: string;
  let dbPath: string;
  let logDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clocktrace-"));
    home = mkdtempSync(join(tmpdir(), "clocktrace-home-"));
    dbPath = join(dir, "clocktrace.db");
    logDir = join(dir, "logs");
    vi.stubEnv("HOME", home);
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
    readonly db?: string;
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
        const layers = Layer.mergeAll(
          Console.setConsole(console),
          NodeContext.layer,
          terminal.layer,
          Prompt.Default,
          Stdin.Test,
          (opts.launchd ?? fakeLaunchd)(state),
          fakeApp(appPresent, executor.recorded),
          Hosts.Default,
          executor.layer,
          Style.Test,
        );
        const exit = yield* Effect.exit(
          uninstall({ purge: opts.purge ?? false, logDir }).pipe(
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
            new Map([["CLOCKTRACE_DB", opts.db ?? dbPath]]),
          ),
        ),
      ),
    );

  it("removes the agent, the app, and the host entry, and resets the grants", async () => {
    // Given: agent loaded, app present, claude on PATH, remove and tccutil ok
    writeState();
    // When
    const { exit, output, recorded, state, appPresent } = await run({
      results: { ...claudeFound, ...claudeRemoved, ...tccReset },
    });
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual([
      "✔ launch agent removed",
      "✔ permissions reset",
      "✔ app removed",
      "✔ Claude Code unregistered",
      "",
      `Done. Database kept at ${dbPath} (clocktrace uninstall --purge deletes it).`,
    ]);
    expect(state.installed).toBe(false);
    expect(state.running).toBe(false);
    expect(appPresent).toBe(false);
    // The grants are reset while Launch Services still knows the bundle
    expect(recorded.slice(0, 2)).toEqual([
      "tccutil reset All com.clocktrace.app",
      "app.remove",
    ]);
    expect(recorded.at(-1)).toBe("claude mcp remove clocktrace --scope user");
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
      `Done. Database kept at ${dbPath} (clocktrace uninstall --purge deletes it).`,
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
      `Done. Database kept at ${dbPath} (clocktrace uninstall --purge deletes it).`,
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

  it("removes the hermes block and keeps the rest of the config", async () => {
    // Given: ~/.hermes/config.yaml with a model and two servers
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    writeFileSync(
      path,
      [
        "model: nous-1",
        "mcp_servers:",
        "  clocktrace:",
        "    command: clocktrace",
        '    args: ["mcp"]',
        "  other:",
        "    command: other",
        "",
      ].join("\n"),
    );
    // When
    const { exit, output } = await run({});
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toContain("✔ Hermes Agent unregistered");
    expect(parse(readFileSync(path, "utf8"))).toEqual({
      model: "nous-1",
      // biome-ignore lint/style/useNamingConvention: the yaml key is snake_case
      mcp_servers: { other: { command: "other" } },
    });
  });

  it("a host remove that fails is reported, the rest still runs, and the exit is 1", async () => {
    // Given: claude and codex on PATH; claude's remove exits 1 printing
    // boom, codex's exits 0; --purge without a terminal
    writeState();
    // When
    const { exit, output } = await run({
      purge: true,
      results: {
        ...claudeFound,
        "which codex": { code: 0 },
        "claude mcp remove clocktrace --scope user": {
          code: 1,
          output: "boom",
        },
        "codex mcp remove clocktrace": { code: 0 },
        ...tccReset,
      },
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
      "✘ Claude Code failed · run by hand: claude mcp remove clocktrace --scope user",
      "✔ Codex unregistered",
      "✔ database removed",
      "✔ logs removed",
      "",
      "Done. Only the clocktrace command remains.",
    ]);
    expect(existsSync(dbPath)).toBe(false);
  });

  it("a host without the server is not registered, not an error", async () => {
    // Given: claude on PATH; its remove prints the real absent message
    // When
    const { exit, output } = await run({
      results: {
        ...claudeFound,
        "claude mcp remove clocktrace --scope user": {
          code: 1,
          output: 'No MCP server named "clocktrace" in user scope',
        },
        ...tccReset,
      },
    });
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toContain("✔ Claude Code not registered");
  });

  it("a host found by its config but not on PATH is a skip line with the manual command", async () => {
    // Given: ~/.claude.json exists, which claude exits 1
    writeFileSync(join(home, ".claude.json"), "{}");
    // When
    const { exit, output, recorded } = await run({ results: tccReset });
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toContain(
      "○ Claude Code: claude not on PATH · run by hand: claude mcp remove clocktrace --scope user",
    );
    expect(recorded).not.toContain("claude mcp remove clocktrace --scope user");
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
      `  log  ${logPath}`,
    ]);
    expect(appPresent).toBe(true);
  });
});
