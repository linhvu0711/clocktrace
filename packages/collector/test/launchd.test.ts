import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { CommandExecutor } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import {
  Cause,
  Effect,
  Exit,
  Layer,
  Option,
  Ref,
  Schema,
  Stream,
} from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  fakeLaunchd,
  Launchd,
  LaunchdError,
  type LaunchdState,
  stateFromPrint,
} from "../src/launchd.js";
import { CollectorPaths, collectorPaths } from "../src/paths.js";
import { type CollectorPlist, CollectorPlistFromJson } from "../src/plist.js";

const samplePlist: CollectorPlist = {
  app: "/Users/me/Applications/Clocktrace.app/Contents/MacOS/Clocktrace",
  node: "/usr/local/bin/node",
  entry: "/repo/main.js",
  databasePath: "/old/clocktrace.db",
  helperPath: "/old-helper",
  logPath: "/Users/me/Library/Logs/clocktrace/collector.log",
};

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
      log: "/Users/me/Library/Logs/clocktrace/collector.log",
    });
    // When
    const message = error.message;
    // Then
    expect(message).toBe(
      "launchctl bootstrap: exit 1 · see /Users/me/Library/Logs/clocktrace/collector.log",
    );
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
      { installed: true, running: false, plist: samplePlist, installs: 1 },
      (launchd) => launchd.bootstrap(),
    );
    // Then: bootstrap fails and the plist is left untouched
    expect(exit).toEqual(Exit.fail(bootstrapError));
    expect(state.running).toBe(false);
    expect(state.plist).toEqual(samplePlist);
  });

  it("a failed fake install leaves no plist", async () => {
    // Given: no plist beforehand
    const { exit, state } = await withLaunchd(
      { installed: false, running: false, plist: null, installs: 0 },
      (launchd) => launchd.install(samplePlist),
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
  let plistPath: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "clocktrace-home-"));
    plistPath = collectorPaths(home).plistPath;
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  // A launchctl stub that reports a chosen exit code for every command,
  // except `print` which answers like launchd does when the job is gone.
  // `string` answers what plutil prints.
  const executor = (
    code: number,
    plutilOut = "",
  ): CommandExecutor.CommandExecutor => ({
    [CommandExecutor.TypeId]: CommandExecutor.TypeId,
    exitCode: (command) =>
      Effect.succeed(
        (command._tag === "StandardCommand" && command.args[0] === "print"
          ? 3
          : code) as CommandExecutor.ExitCode,
      ),
    start: () => Effect.die("unused"),
    string: () => Effect.succeed(plutilOut),
    lines: () => Effect.succeed([]),
    stream: () => Stream.empty,
    streamLines: () => Stream.empty,
  });

  // The real service over a temp home: install writes and (on a failed
  // load) removes a real plist there, never under the machine's
  // `~/Library/LaunchAgents`.
  const withExit = (code: number, plutilOut = "") =>
    Launchd.DefaultWithoutDependencies.pipe(
      Layer.provide(
        Layer.mergeAll(
          NodeFileSystem.layer,
          CollectorPaths.Default(home),
          Layer.succeed(
            CommandExecutor.CommandExecutor,
            executor(code, plutilOut),
          ),
        ),
      ),
    );

  const runInstall = (code: number) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const launchd = yield* Launchd;
        return yield* Effect.exit(launchd.install(samplePlist));
      }).pipe(Effect.provide(withExit(code))),
    );

  const runReadPlist = (plutilOut = "") =>
    Effect.runPromise(
      Effect.gen(function* () {
        const launchd = yield* Launchd;
        return yield* Effect.exit(launchd.readPlist());
      }).pipe(Effect.provide(withExit(0, plutilOut))),
    );

  it("readPlist is null when no plist exists", async () => {
    // Given: the temp home and no plist
    // When / Then
    const exit = await runReadPlist();
    expect(exit).toEqual(Exit.succeed(null));
  });

  it("readPlist fails when the plist cannot be read", async () => {
    // Given: a directory at the plist path so the read hits EISDIR, not
    // ENOENT
    mkdirSync(plistPath, { recursive: true });
    // When / Then: a LaunchdError on the read step; the detail is the OS
    // message
    const exit = await runReadPlist();
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

  it("readPlist decodes what plutil prints", async () => {
    // Given: a plist file, and plutil printing its JSON
    mkdirSync(dirname(plistPath), { recursive: true });
    writeFileSync(plistPath, "<plist/>");
    const json = Schema.encodeSync(CollectorPlistFromJson)(samplePlist);
    // When
    const exit = await runReadPlist(json);
    // Then
    expect(exit).toEqual(Exit.succeed(samplePlist));
  });

  it("readPlist is null for a layout it cannot read", async () => {
    // Given: a plist file whose JSON has none of our keys
    mkdirSync(dirname(plistPath), { recursive: true });
    writeFileSync(plistPath, "<plist/>");
    // When
    const exit = await runReadPlist("{}");
    // Then
    expect(exit).toEqual(Exit.succeed(null));
  });

  it("a failed real install removes the plist it wrote", async () => {
    // Given: launchctl bootstrap fails (exit 1) after the plist is written
    const exit = await runInstall(1);
    // Then: install fails and the plist it wrote is gone
    expect(Exit.isFailure(exit)).toBe(true);
    expect(existsSync(plistPath)).toBe(false);
  });

  it("a successful real install writes the plist", async () => {
    // Given: launchctl bootstrap succeeds (exit 0)
    const exit = await runInstall(0);
    // Then: install succeeds and the plist is present
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(existsSync(plistPath)).toBe(true);
  });

  it("a failed real bootstrap names the collector log", async () => {
    // Given: launchctl bootstrap fails (exit 1) under the temp home
    // When
    const exit = await runInstall(1);
    // Then: the error carries the collector log of that home
    expect(exit).toEqual(
      Exit.fail(
        new LaunchdError({
          step: "launchctl bootstrap",
          detail: "exit 1",
          log: collectorPaths(home).logPath,
        }),
      ),
    );
  });

  it("uninstall removes the plist", async () => {
    // Given: a real install has written the plist
    const seen = await Effect.runPromise(
      Effect.gen(function* () {
        const launchd = yield* Launchd;
        yield* launchd.install(samplePlist);
        const before = existsSync(plistPath);
        yield* launchd.uninstall();
        return { before, after: existsSync(plistPath) };
      }).pipe(Effect.provide(withExit(0))),
    );
    // Then: uninstall removes it
    expect(seen.before).toBe(true);
    expect(seen.after).toBe(false);
  });

  it("uninstall keeps the plist when the unload fails", async () => {
    // Given: a plist written by a real install
    await Effect.runPromise(
      Effect.flatMap(Launchd, (l) => l.install(samplePlist)).pipe(
        Effect.provide(withExit(0)),
      ),
    );
    const before = existsSync(plistPath);
    // When: bootout fails (exit 1, e.g. the job is still loaded)
    const exit = await Effect.runPromise(
      Effect.exit(
        Effect.flatMap(Launchd, (l) => l.uninstall()).pipe(
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
