import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CommandExecutor } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Exit, Layer, Ref, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("install cleanup (real service)", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "clocktrace-home-"));
    vi.stubEnv("HOME", home);
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  // A launchctl stub that reports a chosen exit code for every command.
  const executor = (code: number): CommandExecutor.CommandExecutor => ({
    [CommandExecutor.TypeId]: CommandExecutor.TypeId,
    exitCode: () => Effect.succeed(code as CommandExecutor.ExitCode),
    start: () => Effect.die("unused"),
    string: () => Effect.succeed(""),
    lines: () => Effect.succeed([]),
    stream: () => Stream.empty,
    streamLines: () => Stream.empty,
  });

  // `plistPath` is fixed at import from `os.homedir()`, so the module is
  // imported after HOME is redirected to a temp dir. install then writes and
  // (on a failed load) removes a real plist under that temp home, never the
  // machine's `~/Library/LaunchAgents`.
  const runInstall = async (code: number) => {
    const { Launchd: RealLaunchd, plistPath } = await import(
      "../src/launchd.js"
    );
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const launchd = yield* RealLaunchd;
        return yield* Effect.exit(launchd.install("<plist>"));
      }).pipe(
        Effect.provide(
          RealLaunchd.DefaultWithoutDependencies.pipe(
            Layer.provide(
              Layer.merge(
                NodeFileSystem.layer,
                Layer.succeed(CommandExecutor.CommandExecutor, executor(code)),
              ),
            ),
          ),
        ),
      ),
    );
    return { exit, plistPath };
  };

  it("a failed real install removes the plist it wrote", async () => {
    // Given: launchctl bootstrap fails (exit 1) after the plist is written
    const { exit, plistPath } = await runInstall(1);
    // Then: install fails and the plist it wrote is gone
    expect(Exit.isFailure(exit)).toBe(true);
    expect(existsSync(plistPath)).toBe(false);
  });

  it("a successful real install writes the plist", async () => {
    // Given: launchctl bootstrap succeeds (exit 0)
    const { exit, plistPath } = await runInstall(0);
    // Then: install succeeds and the plist is present
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(existsSync(plistPath)).toBe(true);
  });

  it("uninstall removes the plist", async () => {
    // Given: a real install has written the plist
    const { Launchd: RealLaunchd, plistPath } = await import(
      "../src/launchd.js"
    );
    const layer = RealLaunchd.DefaultWithoutDependencies.pipe(
      Layer.provide(
        Layer.merge(
          NodeFileSystem.layer,
          Layer.succeed(CommandExecutor.CommandExecutor, executor(0)),
        ),
      ),
    );
    const seen = await Effect.runPromise(
      Effect.gen(function* () {
        const launchd = yield* RealLaunchd;
        yield* launchd.install("<plist>");
        const before = existsSync(plistPath);
        yield* launchd.uninstall();
        return { before, after: existsSync(plistPath) };
      }).pipe(Effect.provide(layer)),
    );
    // Then: uninstall removes it
    expect(seen.before).toBe(true);
    expect(seen.after).toBe(false);
  });
});
