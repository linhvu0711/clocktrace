import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CommandExecutor } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Cause, Effect, Exit, Layer, Option, Ref, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fakeLaunchd,
  Launchd,
  LaunchdError,
  type LaunchdState,
  logPath,
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

describe("LaunchdError", () => {
  it("names step, detail, and the log path", () => {
    // Given: a bootstrap failure
    const error = new LaunchdError({
      step: "launchctl bootstrap",
      detail: "exit 1",
    });
    // When
    const message = error.message;
    // Then
    expect(message).toBe(`launchctl bootstrap: exit 1 · see ${logPath}`);
  });

  it("omits the log path for a filesystem failure", () => {
    // Given: a plist write failure, which never reaches the collector log
    const error = new LaunchdError({
      step: "write /tmp/clocktrace.plist",
      detail: "permission denied",
    });
    // When
    const message = error.message;
    // Then
    expect(message).toBe("write /tmp/clocktrace.plist: permission denied");
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

  // A launchctl stub that reports a chosen exit code for every command,
  // except `print` which answers like launchd does when the job is gone.
  const executor = (code: number): CommandExecutor.CommandExecutor => ({
    [CommandExecutor.TypeId]: CommandExecutor.TypeId,
    exitCode: (command) =>
      Effect.succeed(
        (command._tag === "StandardCommand" && command.args[0] === "print"
          ? 3
          : code) as CommandExecutor.ExitCode,
      ),
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

  const runReadPlist = async () => {
    const { Launchd: RealLaunchd, plistPath } = await import(
      "../src/launchd.js"
    );
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const launchd = yield* RealLaunchd;
        return yield* Effect.exit(launchd.readPlist());
      }).pipe(
        Effect.provide(
          RealLaunchd.DefaultWithoutDependencies.pipe(
            Layer.provide(
              Layer.merge(
                NodeFileSystem.layer,
                Layer.succeed(CommandExecutor.CommandExecutor, executor(0)),
              ),
            ),
          ),
        ),
      ),
    );
    return { exit, plistPath };
  };

  it("readPlist is null when no plist exists", async () => {
    // Given: the temp home and no plist
    // When / Then
    const { exit } = await runReadPlist();
    expect(exit).toEqual(Exit.succeed(null));
  });

  it("readPlist fails when the plist cannot be read", async () => {
    // Given: a directory at the plist path so the read hits EISDIR, not
    // ENOENT
    const { plistPath } = await import("../src/launchd.js");
    mkdirSync(plistPath, { recursive: true });
    // When / Then: a LaunchdError on the read step; the detail is the OS
    // message
    const { exit } = await runReadPlist();
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause);
      expect(Option.isSome(failure)).toBe(true);
      if (Option.isSome(failure)) {
        expect(failure.value).toMatchObject({
          _tag: "LaunchdError",
          step: `read ${plistPath}`,
        });
      }
    }
  });

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

  it("uninstall keeps the plist when the unload fails", async () => {
    // Given: a plist written by a real install
    const { Launchd: RealLaunchd, plistPath } = await import(
      "../src/launchd.js"
    );
    const withExit = (code: number) =>
      RealLaunchd.DefaultWithoutDependencies.pipe(
        Layer.provide(
          Layer.merge(
            NodeFileSystem.layer,
            Layer.succeed(CommandExecutor.CommandExecutor, executor(code)),
          ),
        ),
      );
    await Effect.runPromise(
      Effect.flatMap(RealLaunchd, (l) => l.install("<plist>")).pipe(
        Effect.provide(withExit(0)),
      ),
    );
    const before = existsSync(plistPath);
    // When: bootout fails (exit 1, e.g. the job is still loaded)
    const exit = await Effect.runPromise(
      Effect.exit(
        Effect.flatMap(RealLaunchd, (l) => l.uninstall()).pipe(
          Effect.provide(withExit(1)),
        ),
      ),
    );
    // Then: uninstall fails and the plist is left in place
    expect(before).toBe(true);
    expect(Exit.isFailure(exit)).toBe(true);
    expect(existsSync(plistPath)).toBe(true);
  });
});
