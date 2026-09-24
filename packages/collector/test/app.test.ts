import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type Command,
  CommandExecutor,
  FileSystem,
  Error as PlatformError,
} from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import {
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Ref,
  Sink,
  Stream,
} from "effect";
import { NodeInspectSymbol } from "effect/Inspectable";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  App,
  AppError,
  AppNotInstalledError,
  appIconDir,
  appIconFiles,
  hasDeveloperIdSignature,
  infoPlist,
  lsregisterPath,
} from "../src/app.js";
import { CollectorPaths, collectorPaths } from "../src/paths.js";

// The paths are built from a temp home, so installs write a real bundle
// there, never under the machine's ~/Applications.
let home: string;
let appPath: string;
let buildDir: string;
let helperPath: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "clocktrace-home-"));
  buildDir = mkdtempSync(join(tmpdir(), "clocktrace-build-"));
  helperPath = join(buildDir, "clocktrace-helper");
  writeFileSync(helperPath, "helper-bytes");
  appPath = collectorPaths(home).appPath;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(buildDir, { recursive: true, force: true });
});

const fakeProcess = (stderrText: string): CommandExecutor.Process => ({
  [CommandExecutor.ProcessTypeId]: CommandExecutor.ProcessTypeId,
  pid: 0 as CommandExecutor.ProcessId,
  exitCode: Effect.succeed(0 as CommandExecutor.ExitCode),
  isRunning: Effect.succeed(false),
  kill: () => Effect.void,
  stdin: Sink.drain,
  stdout: Stream.empty,
  stderr: Stream.make(new TextEncoder().encode(stderrText)),
  toJSON: () => ({}),
  toString: () => "",
  [NodeInspectSymbol]: () => ({}),
});

const commandRow = (command: Command.Command): ReadonlyArray<string> =>
  command._tag === "StandardCommand"
    ? [command.command, ...command.args]
    : ["<piped>"];

// A CommandExecutor that records every command and answers a chosen
// exit code for `exitCode` calls, and a fake process whose stderr is the
// given codesign -dv text for `start` calls, after `onStart` runs, so a
// case can hang the build there.
const recordingExecutor = (
  recorded: Ref.Ref<ReadonlyArray<ReadonlyArray<string>>>,
  stderrText: string,
  exitCodeFor: (command: Command.Command) => number = () => 0,
  onStart: Effect.Effect<void> = Effect.void,
): CommandExecutor.CommandExecutor => ({
  [CommandExecutor.TypeId]: CommandExecutor.TypeId,
  exitCode: (command) =>
    Ref.update(recorded, (r) => [...r, commandRow(command)]).pipe(
      Effect.as(exitCodeFor(command) as CommandExecutor.ExitCode),
    ),
  start: (command) =>
    Ref.update(recorded, (r) => [...r, commandRow(command)]).pipe(
      Effect.andThen(onStart),
      Effect.as(fakeProcess(stderrText)),
    ),
  string: () => Effect.succeed(""),
  lines: () => Effect.succeed([]),
  stream: () => Stream.empty,
  streamLines: () => Stream.empty,
});

const ADHOC = "Executable=/x\nSignature=adhoc\n";
const DEVID =
  "Executable=/x\nAuthority=Developer ID Application: Example Corp (ABCDE12345)\n";

// The paths whose rename or remove fails with PermissionDenied; every
// other call reaches the real file system.
type Fails = {
  readonly rename?: (from: string) => boolean;
  readonly remove?: (path: string) => boolean;
};

const denied = (method: string, path: string) =>
  Effect.fail(
    new PlatformError.SystemError({
      reason: "PermissionDenied",
      module: "FileSystem",
      method,
      pathOrDescriptor: path,
    }),
  );

const failingFs = (fails: Fails) =>
  Layer.effect(
    FileSystem.FileSystem,
    Effect.map(FileSystem.FileSystem, (fs) => ({
      ...fs,
      rename: (from: string, to: string) =>
        fails.rename?.(from) ? denied("rename", from) : fs.rename(from, to),
      remove: (path: string, options?: FileSystem.RemoveOptions) =>
        fails.remove?.(path)
          ? denied("remove", path)
          : fs.remove(path, options),
    })),
  ).pipe(Layer.provide(NodeFileSystem.layer));

// Every lsregister call exits with `code`, every other command 0.
const lsregisterExits =
  (code: number) =>
  (command: Command.Command): number =>
    command._tag === "StandardCommand" && command.command.includes("lsregister")
      ? code
      : 0;

const runApp = async <A>(
  stderrText: string,
  use: (app: App) => Effect.Effect<A, unknown, never>,
  exitCodeFor?: (command: Command.Command) => number,
  fails: Fails = {},
  onStart?: Effect.Effect<void>,
) => {
  const recorded = await Effect.runPromise(
    Ref.make<ReadonlyArray<ReadonlyArray<string>>>([]),
  );
  const layer = App.DefaultWithoutDependencies.pipe(
    Layer.provide(
      Layer.mergeAll(
        failingFs(fails),
        CollectorPaths.Default(home),
        Layer.succeed(
          CommandExecutor.CommandExecutor,
          recordingExecutor(recorded, stderrText, exitCodeFor, onStart),
        ),
      ),
    ),
  );
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* App;
      return yield* Effect.exit(use(app));
    }).pipe(Effect.provide(layer)),
  );
  const commands = await Effect.runPromise(Ref.get(recorded));
  return { result, commands };
};

describe("infoPlist", () => {
  it("infoPlist carries the bundle keys", async () => {
    // Given: nothing
    // When
    const plist = infoPlist();
    // Then
    expect(plist).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.clocktrace.app</string>
  <key>CFBundleName</key>
  <string>Clocktrace</string>
  <key>CFBundleExecutable</key>
  <string>Clocktrace</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIconName</key>
  <string>AppIcon</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSAppleEventsUsageDescription</key>
  <string>Clocktrace reads the URL of the page in front in your browser.</string>
</dict>
</plist>
`);
  });

  it("no CLI word is in the Info.plist", async () => {
    // Given: infoPlist()
    // When
    const has = /clocktrace (run|setup|start|stop|status|permissions|mcp)/.test(
      infoPlist(),
    );
    // Then
    expect(has).toBe(false);
  });
});

describe("appIconFiles", () => {
  it("the published package carries every icon file", async () => {
    // Given: the collector's package.json, which decides what pnpm deploy
    // ships; a bare-Helper install reads the icons from there
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { readonly files: ReadonlyArray<string> };
    // When
    const missing = appIconFiles.filter(
      (file) => !manifest.files.includes(`assets/${file}`),
    );
    // Then
    expect(missing).toEqual([]);
    for (const file of appIconFiles) {
      expect(existsSync(join(appIconDir, file))).toBe(true);
    }
  });
});

describe("hasDeveloperIdSignature", () => {
  it("hasDeveloperIdSignature is true on an Authority line", async () => {
    // Given: codesign -dv output with a Developer ID authority
    const lines = [
      "Executable=/x/Clocktrace",
      "Identifier=com.clocktrace.app",
      "Authority=Developer ID Application: Example Corp (ABCDE12345)",
      "Authority=Developer ID Certification Authority",
      "Authority=Apple Root CA",
    ];
    // When
    const has = hasDeveloperIdSignature(lines);
    // Then
    expect(has).toBe(true);
  });

  it("hasDeveloperIdSignature is false on ad-hoc and unsigned lines", async () => {
    // Given: ad-hoc and unsigned codesign output
    const adhoc = ["Executable=/x/Clocktrace", "Signature=adhoc"];
    const unsigned = ["/x/Clocktrace: code object is not signed at all"];
    // When
    const a = hasDeveloperIdSignature(adhoc);
    const u = hasDeveloperIdSignature(unsigned);
    // Then
    expect(a).toBe(false);
    expect(u).toBe(false);
  });
});

describe("App.install", () => {
  it("install from a bare Helper writes the bundle, signs ad hoc, and registers", async () => {
    // Given: a temp HOME and a bare helper binary; codesign -dv reports adhoc
    const { result, commands } = await runApp(ADHOC, (app) =>
      app.install(helperPath),
    );
    // Then
    expect(result).toEqual(Exit.succeed("fresh"));
    const appHome = join(home, "Applications", "Clocktrace.app");
    expect(readFileSync(join(appHome, "Contents", "Info.plist"), "utf8")).toBe(
      infoPlist(),
    );
    const mainFile = join(appHome, "Contents", "MacOS", "Clocktrace");
    expect(readFileSync(mainFile, "utf8")).toBe("helper-bytes");
    expect(statSync(mainFile).mode & 0o777).toBe(0o755);
    for (const file of appIconFiles) {
      expect(
        readFileSync(join(appHome, "Contents", "Resources", file)),
      ).toEqual(readFileSync(join(appIconDir, file)));
    }
    const staging = `${appPath}.new`;
    expect(commands).toEqual([
      ["codesign", "-dv", join(staging, "Contents", "MacOS", "Clocktrace")],
      ["codesign", "--force", "--sign", "-", staging],
      [lsregisterPath, "-f", appPath],
    ]);
  });

  it("install with a Developer ID Helper signs nothing and still registers", async () => {
    // Given: the same, with codesign -dv reporting a Developer ID authority
    const { result, commands } = await runApp(DEVID, (app) =>
      app.install(helperPath),
    );
    // Then
    expect(result).toEqual(Exit.succeed("fresh"));
    expect(commands).toEqual([
      [
        "codesign",
        "-dv",
        join(`${appPath}.new`, "Contents", "MacOS", "Clocktrace"),
      ],
      [lsregisterPath, "-f", appPath],
    ]);
  });

  it("install twice rewrites the bundle in place", async () => {
    // Given: one install done; the helper rebuilt and a stale file left behind
    await runApp(ADHOC, (app) => app.install(helperPath));
    writeFileSync(helperPath, "helper-bytes-2");
    const appHome = join(home, "Applications", "Clocktrace.app");
    writeFileSync(join(appHome, "Contents", "stale"), "x");
    // When
    const { result } = await runApp(ADHOC, (app) => app.install(helperPath));
    // Then: the new bundle is in place and the previous one waits in .old
    expect(result).toEqual(Exit.succeed("replaced"));
    expect(
      readFileSync(join(appHome, "Contents", "MacOS", "Clocktrace"), "utf8"),
    ).toBe("helper-bytes-2");
    expect(existsSync(join(appHome, "Contents", "stale"))).toBe(false);
    expect(existsSync(join(appPath, "Contents", "stale"))).toBe(false);
    expect(existsSync(`${appPath}.new`)).toBe(false);
    expect(existsSync(`${appPath}.old`)).toBe(true);
    // When: the install is committed
    const committed = await runApp(ADHOC, (app) => app.commit());
    // Then: the rollback copy is gone
    expect(committed.result).toEqual(Exit.succeed(undefined));
    expect(existsSync(`${appPath}.old`)).toBe(false);
  });

  it("rollback puts the previous app back", async () => {
    // Given: a first install with the old helper; the helper rebuilt
    await runApp(ADHOC, (app) => app.install(helperPath));
    writeFileSync(helperPath, "helper-bytes-2");
    // When: a second install lands and is rolled back
    const { result, commands } = await runApp(ADHOC, (app) =>
      Effect.gen(function* () {
        yield* app.rollback(yield* app.install(helperPath));
      }),
    );
    // Then: the previous bundle is back, .old is gone, and the restored
    // app is registered again
    expect(result).toEqual(Exit.succeed(undefined));
    expect(
      readFileSync(join(appPath, "Contents", "MacOS", "Clocktrace"), "utf8"),
    ).toBe("helper-bytes");
    expect(existsSync(`${appPath}.old`)).toBe(false);
    expect(commands.at(-1)).toEqual([lsregisterPath, "-f", appPath]);
  });

  it("rollback of a fresh install removes the bundle", async () => {
    // Given: a temp HOME with no app; codesign -dv reports adhoc
    // When: a first install lands and is rolled back
    const { result, commands } = await runApp(ADHOC, (app) =>
      Effect.flatMap(app.install(helperPath), (installed) =>
        app.rollback(installed),
      ),
    );
    // Then: no bundle and no sibling is left, and the app is unregistered
    expect(result).toEqual(Exit.succeed(undefined));
    expect(existsSync(appPath)).toBe(false);
    expect(existsSync(`${appPath}.old`)).toBe(false);
    expect(existsSync(`${appPath}.new`)).toBe(false);
    expect(commands.at(-1)).toEqual([lsregisterPath, "-u", appPath]);
  });

  it("rollback restores .old when no app is live", async () => {
    // Given: a previous bundle parked in .old and nothing at the live path
    await runApp(ADHOC, (app) => app.isInstalled());
    mkdirSync(join(`${appPath}.old`, "Contents", "MacOS"), {
      recursive: true,
    });
    writeFileSync(
      join(`${appPath}.old`, "Contents", "MacOS", "Clocktrace"),
      "old-bytes",
    );
    // When
    const { result, commands } = await runApp(ADHOC, (app) =>
      app.rollback("replaced"),
    );
    // Then: the parked bundle is live and registered again
    expect(result).toEqual(Exit.succeed(undefined));
    expect(
      readFileSync(join(appPath, "Contents", "MacOS", "Clocktrace"), "utf8"),
    ).toBe("old-bytes");
    expect(existsSync(`${appPath}.old`)).toBe(false);
    expect(commands).toEqual([[lsregisterPath, "-f", appPath]]);
  });

  it("a failed registration puts the previous app back", async () => {
    // Given: a first install with the old helper; the helper rebuilt
    await runApp(ADHOC, (app) => app.install(helperPath));
    writeFileSync(helperPath, "helper-bytes-2");
    // When: the second install's lsregister exits 1 after the swap
    const { result } = await runApp(
      ADHOC,
      (app) => app.install(helperPath),
      (command) =>
        command._tag === "StandardCommand" &&
        command.command.includes("lsregister")
          ? 1
          : 0,
    );
    // Then: the previous bundle is back and .old is gone, but its own
    // registration failed too, so it is not restored
    expect(result).toEqual(
      Exit.fail(
        new AppNotInstalledError({
          cause: new AppError({ step: "lsregister", detail: "exit 1" }),
          appRestored: false,
        }),
      ),
    );
    expect(
      readFileSync(join(appPath, "Contents", "MacOS", "Clocktrace"), "utf8"),
    ).toBe("helper-bytes");
    expect(existsSync(`${appPath}.old`)).toBe(false);
    expect(existsSync(`${appPath}.new`)).toBe(false);
    expect(existsSync(`${appPath}.reverting`)).toBe(false);
  });

  it("a failed registration on a first install leaves no app", async () => {
    // Given: no app yet; lsregister exits 1, every other command 0
    // When
    const { result } = await runApp(
      ADHOC,
      (app) => app.install(helperPath),
      (command) =>
        command._tag === "StandardCommand" &&
        command.command.includes("lsregister")
          ? 1
          : 0,
    );
    // Then: install fails, restored, and no bundle or sibling is left
    expect(result).toEqual(
      Exit.fail(
        new AppNotInstalledError({
          cause: new AppError({ step: "lsregister", detail: "exit 1" }),
          appRestored: true,
        }),
      ),
    );
    expect(existsSync(appPath)).toBe(false);
    expect(existsSync(`${appPath}.old`)).toBe(false);
    expect(existsSync(`${appPath}.new`)).toBe(false);
  });

  it("a failed registration on a first install whose app cannot be removed is not restored", async () => {
    // Given: no app yet; lsregister exits 1 and the new app cannot be removed
    // When
    const { result } = await runApp(
      ADHOC,
      (app) => app.install(helperPath),
      lsregisterExits(1),
      { remove: (path) => path === appPath },
    );
    // Then: the failure says the app was not restored, and it is still there
    expect(result).toEqual(
      Exit.fail(
        new AppNotInstalledError({
          cause: new AppError({ step: "lsregister", detail: "exit 1" }),
          appRestored: false,
        }),
      ),
    );
    expect(existsSync(appPath)).toBe(true);
  });

  it("a failed registration whose old app cannot come back is not restored", async () => {
    // Given: a first install with the old helper; the helper rebuilt
    await runApp(ADHOC, (app) => app.install(helperPath));
    writeFileSync(helperPath, "helper-bytes-2");
    // When: lsregister exits 1 and .old cannot be renamed back
    const { result } = await runApp(
      ADHOC,
      (app) => app.install(helperPath),
      lsregisterExits(1),
      { rename: (from) => from === `${appPath}.old` },
    );
    // Then: not restored; the new app stays live and the old one in .old
    expect(result).toEqual(
      Exit.fail(
        new AppNotInstalledError({
          cause: new AppError({ step: "lsregister", detail: "exit 1" }),
          appRestored: false,
        }),
      ),
    );
    expect(
      readFileSync(join(appPath, "Contents", "MacOS", "Clocktrace"), "utf8"),
    ).toBe("helper-bytes-2");
    expect(
      readFileSync(
        join(`${appPath}.old`, "Contents", "MacOS", "Clocktrace"),
        "utf8",
      ),
    ).toBe("helper-bytes");
  });

  it("a failed registration whose put-back registers is restored", async () => {
    // Given: a first install with the old helper; the helper rebuilt
    await runApp(ADHOC, (app) => app.install(helperPath));
    writeFileSync(helperPath, "helper-bytes-2");
    // When: only the install's lsregister exits 1; the put-back's exits 0
    let registers = 0;
    const { result } = await runApp(
      ADHOC,
      (app) => app.install(helperPath),
      (command) =>
        command._tag === "StandardCommand" &&
        command.command.includes("lsregister") &&
        registers++ === 0
          ? 1
          : 0,
    );
    // Then: restored; the previous bundle is back and no sibling is left
    expect(result).toEqual(
      Exit.fail(
        new AppNotInstalledError({
          cause: new AppError({ step: "lsregister", detail: "exit 1" }),
          appRestored: true,
        }),
      ),
    );
    expect(
      readFileSync(join(appPath, "Contents", "MacOS", "Clocktrace"), "utf8"),
    ).toBe("helper-bytes");
    expect(existsSync(`${appPath}.old`)).toBe(false);
    expect(existsSync(`${appPath}.new`)).toBe(false);
    expect(existsSync(`${appPath}.reverting`)).toBe(false);
  });

  it("a failed swap whose old app cannot come back is not restored", async () => {
    // Given: a first install with the old helper; the helper rebuilt
    await runApp(ADHOC, (app) => app.install(helperPath));
    writeFileSync(helperPath, "helper-bytes-2");
    // When: the staged app cannot be renamed in, nor .old renamed back
    const { result } = await runApp(
      ADHOC,
      (app) => app.install(helperPath),
      undefined,
      {
        rename: (from) =>
          from === `${appPath}.new` || from === `${appPath}.old`,
      },
    );
    // Then: not restored, no live app, and the old app waits in .old
    const error =
      Exit.isFailure(result) && result.cause._tag === "Fail"
        ? result.cause.error
        : undefined;
    expect(error).toBeInstanceOf(AppNotInstalledError);
    expect(error).toMatchObject({
      appRestored: false,
      cause: { step: `rename ${appPath}.new` },
    });
    expect(existsSync(appPath)).toBe(false);
    expect(
      readFileSync(
        join(`${appPath}.old`, "Contents", "MacOS", "Clocktrace"),
        "utf8",
      ),
    ).toBe("helper-bytes");
  });

  it("a failed swap puts the old app back", async () => {
    // Given: a first install with the old helper; the helper rebuilt
    await runApp(ADHOC, (app) => app.install(helperPath));
    writeFileSync(helperPath, "helper-bytes-2");
    // When: the staged app cannot be renamed in
    const { result } = await runApp(
      ADHOC,
      (app) => app.install(helperPath),
      undefined,
      { rename: (from) => from === `${appPath}.new` },
    );
    // Then: restored; the old app is live and no staging is left
    const error =
      Exit.isFailure(result) && result.cause._tag === "Fail"
        ? result.cause.error
        : undefined;
    expect(error).toBeInstanceOf(AppNotInstalledError);
    expect(error).toMatchObject({
      appRestored: true,
      cause: { step: `rename ${appPath}.new` },
    });
    expect(
      readFileSync(join(appPath, "Contents", "MacOS", "Clocktrace"), "utf8"),
    ).toBe("helper-bytes");
    expect(existsSync(`${appPath}.new`)).toBe(false);
  });

  it("install copies a built app next to the Helper whole and signs nothing", async () => {
    // Given: a built Clocktrace.app sitting next to the helper
    const built = join(buildDir, "Clocktrace.app");
    mkdirSync(join(built, "Contents", "MacOS"), { recursive: true });
    mkdirSync(join(built, "Contents", "_CodeSignature"), {
      recursive: true,
    });
    writeFileSync(join(built, "Contents", "Info.plist"), "<built>");
    writeFileSync(
      join(built, "Contents", "MacOS", "Clocktrace"),
      "built-bytes",
    );
    writeFileSync(
      join(built, "Contents", "_CodeSignature", "CodeResources"),
      "sig",
    );
    // When
    const { result, commands } = await runApp(ADHOC, (app) =>
      app.install(helperPath),
    );
    // Then
    expect(result).toEqual(Exit.succeed("fresh"));
    const appHome = join(home, "Applications", "Clocktrace.app");
    expect(readFileSync(join(appHome, "Contents", "Info.plist"), "utf8")).toBe(
      "<built>",
    );
    expect(
      readFileSync(join(appHome, "Contents", "MacOS", "Clocktrace"), "utf8"),
    ).toBe("built-bytes");
    expect(
      readFileSync(
        join(appHome, "Contents", "_CodeSignature", "CodeResources"),
        "utf8",
      ),
    ).toBe("sig");
    expect(commands).toEqual([[lsregisterPath, "-f", appPath]]);
  });

  it("a failed codesign fails install with its step", async () => {
    // Given: a first install done with the Helper helper-bytes
    await runApp(ADHOC, (app) => app.install(helperPath));
    writeFileSync(helperPath, "helper-bytes-2");
    // When: the second install's codesign --force exits 1
    const { result } = await runApp(
      ADHOC,
      (app) => app.install(helperPath),
      (command) =>
        command._tag === "StandardCommand" && command.args[0] === "--force"
          ? 1
          : 0,
    );
    // Then: install fails and the previous app is untouched
    expect(result).toEqual(
      Exit.fail(new AppError({ step: "codesign", detail: "exit 1" })),
    );
    expect(
      readFileSync(join(appPath, "Contents", "MacOS", "Clocktrace"), "utf8"),
    ).toBe("helper-bytes");
    expect(existsSync(`${appPath}.new`)).toBe(false);
  });

  it("a stop during the build leaves the old app untouched", async () => {
    // Given: a first install done with the Helper helper-bytes, and a
    // second build that hangs at codesign -dv
    await runApp(ADHOC, (app) => app.install(helperPath));
    writeFileSync(helperPath, "helper-bytes-2");
    const reached = Effect.runSync(Deferred.make<void>());
    // When: the install runs uninterruptible, as Lifecycle runs it, and is
    // stopped (Ctrl-C) during the build
    const { result } = await runApp(
      ADHOC,
      (app) =>
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(
            Effect.uninterruptible(app.install(helperPath)),
          );
          yield* Deferred.await(reached);
          return yield* Fiber.interrupt(fiber);
        }),
      undefined,
      {},
      Deferred.succeed(reached, undefined).pipe(Effect.andThen(Effect.never)),
    );
    // Then: install stopped, the previous app is live, and no .old or
    // .new is left
    expect(Exit.isSuccess(result) && Exit.isInterrupted(result.value)).toBe(
      true,
    );
    expect(
      readFileSync(join(appPath, "Contents", "MacOS", "Clocktrace"), "utf8"),
    ).toBe("helper-bytes");
    expect(existsSync(`${appPath}.old`)).toBe(false);
    expect(existsSync(`${appPath}.new`)).toBe(false);
  });

  it("isInstalled is false before install and true after", async () => {
    // Given: the temp HOME with nothing installed yet
    const { result } = await runApp(ADHOC, (app) =>
      Effect.gen(function* () {
        const before = yield* app.isInstalled();
        yield* app.install(helperPath);
        const after = yield* app.isInstalled();
        return { before, after };
      }),
    );
    // Then
    expect(result).toEqual(Exit.succeed({ before: false, after: true }));
  });

  it("remove deletes the bundle, .old, and .new, and unregisters it", async () => {
    // Given: an installed app, a parked .old bundle, and a stale .new one
    await runApp(ADHOC, (app) => app.install(helperPath));
    await runApp(ADHOC, (app) => app.isInstalled());
    mkdirSync(join(`${appPath}.old`, "Contents"), { recursive: true });
    mkdirSync(join(`${appPath}.new`, "Contents"), { recursive: true });
    // When
    const { result, commands } = await runApp(ADHOC, (app) => app.remove());
    // Then
    expect(result).toEqual(Exit.succeed("removed"));
    expect(existsSync(appPath)).toBe(false);
    expect(existsSync(`${appPath}.old`)).toBe(false);
    expect(existsSync(`${appPath}.new`)).toBe(false);
    expect(commands).toEqual([[lsregisterPath, "-u", appPath]]);
  });

  it("remove without a bundle is absent and runs nothing", async () => {
    // Given: nothing at the app path
    // When
    const { result, commands } = await runApp(ADHOC, (app) => app.remove());
    // Then
    expect(result).toEqual(Exit.succeed("absent"));
    expect(existsSync(appPath)).toBe(false);
    expect(commands).toEqual([]);
  });
});
