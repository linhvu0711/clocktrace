import { Effect, Exit, Ref } from "effect";
import { describe, expect, it } from "vitest";

import {
  fakeLaunchd,
  Launchd,
  LaunchdError,
  type LaunchdState,
  stateFromPrint,
} from "../src/launchd.js";

describe("stateFromPrint", () => {
  it("state = running is running", () => {
    // Given: print output with a running state line
    const lines = [
      "com.clocktrace.collector = {",
      "\tactive count = 1",
      "\tstate = running",
      "}",
    ];
    // When
    const state = stateFromPrint(lines);
    // Then
    expect(state).toBe("running");
  });

  it("state = not running is stopped", () => {
    // Given: print output with a not running state line
    const lines = [
      "com.clocktrace.collector = {",
      "\tstate = not running",
      "\tlast exit code = 1",
      "}",
    ];
    // When
    const state = stateFromPrint(lines);
    // Then
    expect(state).toBe("stopped");
  });

  it("no output is stopped", () => {
    // Given: [] (what exit 113 leaves on stdout)
    // When
    const state = stateFromPrint([]);
    // Then
    expect(state).toBe("stopped");
  });
});

describe("fakeLaunchd failBootstrap", () => {
  const bootstrapError = new LaunchdError({
    step: "launchctl bootstrap",
    detail: "exit 1",
  });

  const withLaunchd = <A, E>(
    initial: LaunchdState,
    use: (launchd: Launchd) => Effect.Effect<A, E, never>,
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const state = yield* Ref.make(initial);
        const exit = yield* Effect.gen(function* () {
          const launchd = yield* Launchd;
          return yield* Effect.exit(use(launchd));
        }).pipe(Effect.provide(fakeLaunchd(state, { failBootstrap: true })));
        return { exit, state: yield* Ref.get(state) };
      }),
    );

  it("fakeLaunchd can fail the bootstrap", async () => {
    // Given: a plist present but the Collector not loaded
    const { exit, state } = await withLaunchd(
      { installed: true, running: false, plist: "<plist>", installs: 1 },
      (launchd) => launchd.bootstrap(),
    );
    // Then: bootstrap fails and the plist is left untouched
    expect(exit).toEqual(Exit.fail(bootstrapError));
    expect(state.running).toBe(false);
    expect(state.plist).toBe("<plist>");
  });

  it("a failed fake install leaves no plist", async () => {
    // Given: no plist beforehand
    const { exit, state } = await withLaunchd(
      { installed: false, running: false, plist: null, installs: 0 },
      (launchd) => launchd.install("<plist>"),
    );
    // Then: the failed install leaves the state clean, no plist
    expect(exit).toEqual(Exit.fail(bootstrapError));
    expect(state.installed).toBe(false);
    expect(state.plist).toBe(null);
    expect(state.installs).toBe(0);
  });
});
