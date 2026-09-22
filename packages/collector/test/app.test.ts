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

import { type Command, CommandExecutor } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Exit, Layer, Ref, Sink, Stream } from "effect";
import { NodeInspectSymbol } from "effect/Inspectable";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `appPath` is fixed at import from `os.homedir()`, so the module is
// imported after HOME is redirected to a temp dir — installs then write a
// real bundle under that temp home, never the machine's ~/Applications.
let home: string;
let buildDir: string;
let helperPath: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "clocktrace-home-"));
  buildDir = mkdtempSync(join(tmpdir(), "clocktrace-build-"));
  helperPath = join(buildDir, "clocktrace-helper");
  writeFileSync(helperPath, "helper-bytes");
  vi.stubEnv("HOME", home);
  vi.resetModules();
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(buildDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.resetModules();
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
// given codesign -dv text for `start` calls.
const recordingExecutor = (
  recorded: Ref.Ref<ReadonlyArray<ReadonlyArray<string>>>,
  stderrText: string,
  exitCodeFor: (command: Command.Command) => number = () => 0,
): CommandExecutor.CommandExecutor => ({
  [CommandExecutor.TypeId]: CommandExecutor.TypeId,
  exitCode: (command) =>
    Ref.update(recorded, (r) => [...r, commandRow(command)]).pipe(
      Effect.as(exitCodeFor(command) as CommandExecutor.ExitCode),
    ),
  start: (command) =>
    Ref.update(recorded, (r) => [...r, commandRow(command)]).pipe(
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

const runApp = async <A>(
  stderrText: string,
  use: (app: import("../src/app.js").App) => Effect.Effect<A, unknown, never>,
  exitCodeFor?: (command: Command.Command) => number,
) => {
  const mod = await import("../src/app.js");
  const recorded = await Effect.runPromise(
    Ref.make<ReadonlyArray<ReadonlyArray<string>>>([]),
  );
  const layer = mod.App.DefaultWithoutDependencies.pipe(
    Layer.provide(
      Layer.merge(
        NodeFileSystem.layer,
        Layer.succeed(
          CommandExecutor.CommandExecutor,
          recordingExecutor(recorded, stderrText, exitCodeFor),
        ),
      ),
    ),
  );
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const app = yield* mod.App;
      return yield* Effect.exit(use(app));
    }).pipe(Effect.provide(layer)),
  );
  const commands = await Effect.runPromise(Ref.get(recorded));
  return { result, commands, mod };
};

describe("infoPlist", () => {
  it("infoPlist carries the bundle keys", async () => {
    // Given: nothing
    const { infoPlist } = await import("../src/app.js");
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
    const { infoPlist } = await import("../src/app.js");
    // When
    const has = /clocktrace (run|setup|start|stop|status|permissions|mcp)/.test(
      infoPlist(),
    );
    // Then
    expect(has).toBe(false);
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
    const { hasDeveloperIdSignature } = await import("../src/app.js");
    // When
    const has = hasDeveloperIdSignature(lines);
    // Then
    expect(has).toBe(true);
  });

  it("hasDeveloperIdSignature is false on ad-hoc and unsigned lines", async () => {
    // Given: ad-hoc and unsigned codesign output
    const adhoc = ["Executable=/x/Clocktrace", "Signature=adhoc"];
    const unsigned = ["/x/Clocktrace: code object is not signed at all"];
    const { hasDeveloperIdSignature } = await import("../src/app.js");
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
    const { result, commands, mod } = await runApp(ADHOC, (app) =>
      app.install(helperPath),
    );
    // Then
    expect(result).toEqual(Exit.succeed("written"));
    const appHome = join(home, "Applications", "Clocktrace.app");
    expect(readFileSync(join(appHome, "Contents", "Info.plist"), "utf8")).toBe(
      mod.infoPlist(),
    );
    const mainFile = join(appHome, "Contents", "MacOS", "Clocktrace");
    expect(readFileSync(mainFile, "utf8")).toBe("helper-bytes");
    expect(statSync(mainFile).mode & 0o777).toBe(0o755);
    const staging = `${mod.appPath}.new`;
    expect(commands).toEqual([
      ["codesign", "-dv", join(staging, "Contents", "MacOS", "Clocktrace")],
      ["codesign", "--force", "--sign", "-", staging],
      [mod.lsregisterPath, "-f", mod.appPath],
    ]);
  });

  it("install with a Developer ID Helper signs nothing and still registers", async () => {
    // Given: the same, with codesign -dv reporting a Developer ID authority
    const { result, commands, mod } = await runApp(DEVID, (app) =>
      app.install(helperPath),
    );
    // Then
    expect(result).toEqual(Exit.succeed("written"));
    expect(commands).toEqual([
      [
        "codesign",
        "-dv",
        join(`${mod.appPath}.new`, "Contents", "MacOS", "Clocktrace"),
      ],
      [mod.lsregisterPath, "-f", mod.appPath],
    ]);
  });

  it("install twice rewrites the bundle in place", async () => {
    // Given: one install done; the helper rebuilt and a stale file left behind
    await runApp(ADHOC, (app) => app.install(helperPath));
    writeFileSync(helperPath, "helper-bytes-2");
    const appHome = join(home, "Applications", "Clocktrace.app");
    writeFileSync(join(appHome, "Contents", "stale"), "x");
    // When
    const { result, mod } = await runApp(ADHOC, (app) =>
      app.install(helperPath),
    );
    // Then: the new bundle is in place and the previous one waits in .old
    expect(result).toEqual(Exit.succeed("written"));
    expect(
      readFileSync(join(appHome, "Contents", "MacOS", "Clocktrace"), "utf8"),
    ).toBe("helper-bytes-2");
    expect(existsSync(join(appHome, "Contents", "stale"))).toBe(false);
    expect(existsSync(join(mod.appPath, "Contents", "stale"))).toBe(false);
    expect(existsSync(`${mod.appPath}.new`)).toBe(false);
    expect(existsSync(`${mod.appPath}.old`)).toBe(true);
    // When: the install is committed
    const committed = await runApp(ADHOC, (app) => app.commit());
    // Then: the rollback copy is gone
    expect(committed.result).toEqual(Exit.succeed(undefined));
    expect(existsSync(`${mod.appPath}.old`)).toBe(false);
  });

  it("rollback puts the previous app back", async () => {
    // Given: a first install with the old helper; the helper rebuilt
    await runApp(ADHOC, (app) => app.install(helperPath));
    writeFileSync(helperPath, "helper-bytes-2");
    // When: a second install lands and is rolled back
    const { result, commands, mod } = await runApp(ADHOC, (app) =>
      Effect.gen(function* () {
        yield* app.install(helperPath);
        yield* app.rollback();
      }),
    );
    // Then: the previous bundle is back, .old is gone, and the restored
    // app is registered again
    expect(result).toEqual(Exit.succeed(undefined));
    expect(
      readFileSync(
        join(mod.appPath, "Contents", "MacOS", "Clocktrace"),
        "utf8",
      ),
    ).toBe("helper-bytes");
    expect(existsSync(`${mod.appPath}.old`)).toBe(false);
    expect(commands.at(-1)).toEqual([mod.lsregisterPath, "-f", mod.appPath]);
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
    const { result, commands, mod } = await runApp(ADHOC, (app) =>
      app.install(helperPath),
    );
    // Then
    expect(result).toEqual(Exit.succeed("copied"));
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
    expect(commands).toEqual([[mod.lsregisterPath, "-f", mod.appPath]]);
  });

  it("a failed codesign fails install with its step", async () => {
    // Given: a first install done with the Helper helper-bytes
    await runApp(ADHOC, (app) => app.install(helperPath));
    writeFileSync(helperPath, "helper-bytes-2");
    // When: the second install's codesign --force exits 1
    const { result, mod } = await runApp(
      ADHOC,
      (app) => app.install(helperPath),
      (command) =>
        command._tag === "StandardCommand" && command.args[0] === "--force"
          ? 1
          : 0,
    );
    // Then: install fails and the previous app is untouched
    expect(result).toEqual(
      Exit.fail(new mod.AppError({ step: "codesign", detail: "exit 1" })),
    );
    expect(
      readFileSync(
        join(mod.appPath, "Contents", "MacOS", "Clocktrace"),
        "utf8",
      ),
    ).toBe("helper-bytes");
    expect(existsSync(`${mod.appPath}.new`)).toBe(false);
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
});
