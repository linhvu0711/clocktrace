import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  App,
  AppMissingError,
  appMainPath,
  fakeLaunchd,
  Helper,
  Launchd,
  LaunchdError,
  type LaunchdState,
} from "@clocktrace/collector";
import { openStore } from "@clocktrace/core";
import type { Path, Terminal } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import {
  ConfigProvider,
  Console,
  DateTime,
  Effect,
  Exit,
  Layer,
  Ref,
} from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Style } from "../src/format.js";
import { ReportedError } from "../src/output.js";
import { Prompt } from "../src/prompt.js";
import { NotSetUpError } from "../src/set-up.js";
import { start } from "../src/start.js";
import { stop } from "../src/stop.js";
import * as MockConsole from "./mock-console.js";
import * as MockTerminal from "./mock-terminal.js";

describe("start and stop", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "clocktrace-"));
    path = join(dir, "clocktrace.db");
    await Effect.runPromise(Effect.scoped(openStore(path)));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const run = <A, E>(
    launchdState: LaunchdState,
    command: Effect.Effect<
      A,
      E,
      | Prompt
      | Launchd
      | Terminal.Terminal
      | Path.Path
      | import("@effect/platform").FileSystem.FileSystem
      | App
      | Style
    >,
    makeLaunchd?: (state: Ref.Ref<LaunchdState>) => Layer.Layer<Launchd>,
    appLayer: Layer.Layer<App> = App.Test,
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = yield* MockTerminal.make(true);
        const console = yield* MockConsole.make;
        const state = yield* Ref.make(launchdState);
        const layers = Layer.mergeAll(
          Console.setConsole(console),
          NodeContext.layer,
          terminal.layer,
          Prompt.Default,
          (makeLaunchd ?? fakeLaunchd)(state),
          Helper.Test,
          appLayer,
          Style.Test,
        );
        const exit = yield* Effect.exit(command.pipe(Effect.provide(layers)));
        return {
          exit,
          output: yield* console.getLines({ stripAnsi: true }),
          errors: yield* console.getErrorLines({ stripAnsi: true }),
          state: yield* Ref.get(state),
        };
      }).pipe(
        Effect.withConfigProvider(
          ConfigProvider.fromMap(
            new Map([
              ["CLOCKTRACE_HELPER", "/stub"],
              ["CLOCKTRACE_DB", path],
            ]),
          ),
        ),
        DateTime.withCurrentZoneNamed("America/Los_Angeles"),
      ),
    );

  it("start twice leaves the Collector running", async () => {
    // Given: set up, collector stopped
    // When
    const { exit, output, state } = await run(
      { installed: true, running: false, plist: null, installs: 0 },
      Effect.andThen(start(), start()),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual(["✔ collector running", "✔ collector running"]);
    expect(state.running).toBe(true);
  });

  it("stop twice leaves it stopped", async () => {
    // Given: set up, collector running
    // When
    const { exit, output, state } = await run(
      { installed: true, running: true, plist: null, installs: 0 },
      Effect.andThen(stop(), stop()),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual(["✔ collector stopped", "✔ collector stopped"]);
    expect(state.running).toBe(false);
  });

  it("start without the app fails and leaves launchd alone", async () => {
    // Given: the plist installed, not running, and no app present
    const noApp = Layer.succeed(
      App,
      new App({
        isInstalled: () => Effect.succeed(false),
        install: () => Effect.succeed("written" as const),
      }),
    );
    // When
    const { exit, output, state } = await run(
      { installed: true, running: false, plist: null, installs: 0 },
      start(),
      undefined,
      noApp,
    );
    // Then
    expect(exit).toEqual(Exit.fail(new AppMissingError({ path: appMainPath })));
    expect(output).toEqual([]);
    expect(state.running).toBe(false);
  });

  it("a failed start prints the mark, the step, and the log path", async () => {
    // Given: set up, the Collector stopped, the bootstrap step fails
    // When
    const { exit, errors } = await run(
      { installed: true, running: false, plist: null, installs: 0 },
      start(),
      (state) => fakeLaunchd(state, { failBootstrap: true }),
    );
    // Then
    expect(Exit.isFailure(exit)).toBe(true);
    expect(errors).toEqual([
      "✘ launchctl bootstrap: exit 1",
      "  log  ~/Library/Logs/clocktrace/collector.log",
    ]);
  });

  it("a failed start fails with ReportedError so main exits 1", async () => {
    // Given: the same as the case above
    // When
    const { exit } = await run(
      { installed: true, running: false, plist: null, installs: 0 },
      start(),
      (state) => fakeLaunchd(state, { failBootstrap: true }),
    );
    // Then
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
  });

  it("a failed stop prints the mark, the step, and the log path", async () => {
    // Given: set up and a Launchd whose bootout fails
    const stub = () =>
      Layer.succeed(
        Launchd,
        new Launchd({
          isInstalled: () => Effect.succeed(true),
          readPlist: () => Effect.succeed(null),
          install: () => Effect.void,
          bootstrap: () => Effect.void,
          uninstall: () => Effect.void,
          state: () => Effect.succeed("running"),
          bootout: () =>
            Effect.fail(
              new LaunchdError({
                step: "launchctl bootout",
                detail: "exit 1",
              }),
            ),
        }),
      );
    // When
    const { exit, errors } = await run(
      { installed: true, running: true, plist: null, installs: 0 },
      stop(),
      stub,
    );
    // Then
    expect(Exit.isFailure(exit)).toBe(true);
    expect(errors).toEqual([
      "✘ launchctl bootout: exit 1",
      "  log  ~/Library/Logs/clocktrace/collector.log",
    ]);
  });

  it("start before setup fails not set up", async () => {
    // Given: no plist (the database file exists from the fixture is removed by
    // the missing install)
    const { exit, state } = await run(
      { installed: false, running: false, plist: null, installs: 0 },
      start(),
    );
    // Then
    expect(exit).toEqual(Exit.fail(new NotSetUpError({ dbPath: path })));
    expect(state.running).toBe(false);
  });
});
