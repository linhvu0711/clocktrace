import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fakeLaunchd,
  Helper,
  type Launchd,
  type LaunchdState,
} from "@clocktrace/collector";
import { openStore } from "@clocktrace/core";
import { NodeContext } from "@effect/platform-node";
import { ConfigProvider, DateTime, Effect, Exit, Layer, Ref } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { fakePrompt, type Prompt } from "../src/prompt.js";
import { NotSetUpError } from "../src/set-up.js";
import { start } from "../src/start.js";
import { stop } from "../src/stop.js";

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
      Prompt | Launchd | import("@effect/platform").FileSystem.FileSystem
    >,
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const prompt = yield* fakePrompt([], true);
        const state = yield* Ref.make(launchdState);
        const layers = Layer.mergeAll(
          prompt.layer,
          fakeLaunchd(state),
          Helper.Test,
          NodeContext.layer,
        );
        const exit = yield* Effect.exit(command.pipe(Effect.provide(layers)));
        return {
          exit,
          output: yield* Ref.get(prompt.output),
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
    expect(output).toEqual(["collector: running", "collector: running"]);
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
    expect(output).toEqual(["collector: stopped", "collector: stopped"]);
    expect(state.running).toBe(false);
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
