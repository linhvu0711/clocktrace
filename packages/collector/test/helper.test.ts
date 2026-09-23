import { readFileSync, writeFileSync } from "node:fs";

import { CommandExecutor } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import {
  Chunk,
  DateTime,
  Effect,
  Exit,
  Inspectable,
  Layer,
  Logger,
  Ref,
  type Scope,
  Sink,
  Stream,
} from "effect";
import { describe, expect, it } from "vitest";

import {
  Helper,
  HelperExitedError,
  HelperFailedError,
  openArgs,
  sinceArgs,
} from "../src/helper.js";

describe("HelperExitedError", () => {
  it("HelperExitedError names the cause", () => {
    // Given: a Helper that exited non-zero
    const error = new HelperExitedError({
      cause: "permissions request exited 3",
    });
    // When
    const message = error.message;
    // Then
    expect(message).toBe("helper exited: permissions request exited 3");
    expect(message.length).toBeGreaterThan(0);
  });

  it("sinceArgs writes one --since per Device", () => {
    // Given: Progress for two devices, one with a fractional ts
    const map = new Map([
      ["b-device", 200.7],
      ["a-device", 150],
    ]);
    // When
    const args = sinceArgs(map);
    // Then
    expect(args).toEqual([
      "--since",
      "a-device=150",
      "--since",
      "b-device=200",
    ]);
  });

  it("sinceArgs is empty without Progress", () => {
    // Given: no Progress
    // When
    const args = sinceArgs(new Map());
    // Then
    expect(args).toEqual([]);
  });
});

// Answers `open` the chosen exit code after recording the command and
// writing what the Helper would have printed to the --stdout file.
const openExecutor = (
  recorded: Ref.Ref<ReadonlyArray<ReadonlyArray<string>>>,
  stdoutText: string,
  code: number = 0,
  stderrText: string = "",
): CommandExecutor.CommandExecutor => ({
  [CommandExecutor.TypeId]: CommandExecutor.TypeId,
  exitCode: (command) =>
    Ref.update(recorded, (r) => [
      ...r,
      command._tag === "StandardCommand"
        ? [command.command, ...command.args]
        : ["<piped>"],
    ]).pipe(
      Effect.andThen(
        Effect.sync(() => {
          if (command._tag === "StandardCommand") {
            const at = command.args.indexOf("--stdout");
            const target = command.args[at + 1];
            if (target !== undefined) {
              writeFileSync(target, stdoutText);
            }
            const errAt = command.args.indexOf("--stderr");
            const errTarget = command.args[errAt + 1];
            if (errTarget !== undefined) {
              writeFileSync(errTarget, stderrText);
            }
          }
        }),
      ),
      Effect.as(code as CommandExecutor.ExitCode),
    ),
  start: () => Effect.die("start unused"),
  string: () => Effect.succeed(""),
  lines: () => Effect.succeed([]),
  stream: () => Stream.empty,
  streamLines: () => Stream.empty,
});

const runHelper = <A>(
  use: (helper: Helper) => Effect.Effect<A, unknown, Scope.Scope>,
  stdoutText: string,
  code: number = 0,
  stderrText: string = "",
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const recorded = yield* Ref.make<ReadonlyArray<ReadonlyArray<string>>>(
        [],
      );
      const layer = Helper.DefaultWithoutDependencies.pipe(
        Layer.provide(
          Layer.merge(
            NodeFileSystem.layer,
            Layer.succeed(
              CommandExecutor.CommandExecutor,
              openExecutor(recorded, stdoutText, code, stderrText),
            ),
          ),
        ),
      );
      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const helper = yield* Helper;
          return yield* Effect.scoped(use(helper));
        }).pipe(Effect.provide(layer)),
      );
      const commands = yield* Ref.get(recorded);
      return { exit, commands };
    }),
  );

// Answers every started command as one finished process: the given stdout,
// stderr, and exit code. `runBiome` and `Command.streamLines` both start one.
const processExecutor = (
  stdoutText: string,
  code: number = 0,
  stderrText: string = "",
): CommandExecutor.CommandExecutor =>
  CommandExecutor.makeExecutor(() =>
    Effect.succeed({
      ...Inspectable.BaseProto,
      [CommandExecutor.ProcessTypeId]: CommandExecutor.ProcessTypeId,
      pid: CommandExecutor.ProcessId(1),
      exitCode: Effect.succeed(CommandExecutor.ExitCode(code)),
      isRunning: Effect.succeed(false),
      kill: () => Effect.void,
      stdout: Stream.make(new TextEncoder().encode(stdoutText)),
      stderr: Stream.make(new TextEncoder().encode(stderrText)),
      stdin: Sink.drain,
    }),
  );

const runHelperProcess = <A>(
  use: (helper: Helper) => Effect.Effect<A, unknown, Scope.Scope>,
  stdoutText: string,
  code: number = 0,
  stderrText: string = "",
) => {
  const logs: Array<string> = [];
  const testLogger = Logger.replace(
    Logger.defaultLogger,
    Logger.make(({ message }) => {
      logs.push(String(message));
    }),
  );
  const layer = Helper.DefaultWithoutDependencies.pipe(
    Layer.provide(
      Layer.merge(
        NodeFileSystem.layer,
        Layer.succeed(
          CommandExecutor.CommandExecutor,
          processExecutor(stdoutText, code, stderrText),
        ),
      ),
    ),
  );
  return Effect.runPromise(
    Effect.exit(
      Effect.gen(function* () {
        const helper = yield* Helper;
        return yield* Effect.scoped(use(helper));
      }).pipe(Effect.provide(Layer.merge(layer, testLogger))),
    ),
  ).then((exit) => ({ exit, logs }));
};

describe("Helper watch", () => {
  it("a bad watch line is logged and skipped", async () => {
    // Given: two Helper lines with a line that is not JSON between them
    const stdout = [
      '{"ts":"2026-01-01T00:00:00Z","app":"Safari","bundleId":"com.apple.Safari","title":null,"url":null,"idleSeconds":0,"missing":[]}',
      "not json",
      '{"ts":"2026-01-01T00:00:10Z","app":"Safari","bundleId":"com.apple.Safari","title":null,"url":null,"idleSeconds":0,"missing":[]}',
    ].join("\n");
    // When
    const { exit, logs } = await runHelperProcess(
      (helper) =>
        helper.lines("/h").pipe(
          Stream.take(2),
          Stream.runCollect,
          Effect.map((chunk) =>
            Chunk.toReadonlyArray(chunk).map((line) => ({
              ts: DateTime.formatIso(line.ts),
              app: line.app,
              grant: line.grant,
            })),
          ),
        ),
      stdout,
    );
    // Then
    expect({ readings: Exit.isSuccess(exit) && exit.value, logs }).toEqual({
      readings: [
        { ts: "2026-01-01T00:00:00.000Z", app: "Safari", grant: null },
        { ts: "2026-01-01T00:00:10.000Z", app: "Safari", grant: null },
      ],
      logs: ["helper line rejected"],
    });
  });
});

// The failure a Helper call ended with, or null when it succeeded.
const failure = (exit: Exit.Exit<unknown, unknown>): unknown =>
  Exit.isFailure(exit) && exit.cause._tag === "Fail" ? exit.cause.error : null;

// A sample file the Swift tests compare the Helper's output against, so both
// sides agree on every line kind.
const sharedSample = (name: string): string =>
  readFileSync(
    new URL(
      `../../helper/Tests/HelperCoreTests/Fixtures/${name}`,
      import.meta.url,
    ),
    "utf8",
  );

describe("Helper biome devices", () => {
  it("biome devices exit 0 gives decoded devices", async () => {
    // Given: biome devices printed the iPad's DevicePeer row and exited 0
    const stdout =
      '{"deviceIdentifier":"00000000-0000-4000-8000-000000000003","lastSyncDate":1789664400,"me":false,"model":"24A437","name":"Linh\'s iPad","platform":1}\n';
    // When
    const { exit } = await runHelperProcess(
      (helper) => helper.biomeDevices("/h"),
      stdout,
    );
    // Then
    expect(Exit.isSuccess(exit) && exit.value).toEqual([
      {
        deviceIdentifier: "00000000-0000-4000-8000-000000000003",
        me: false,
        name: "Linh's iPad",
        model: "24A437",
        platform: 1,
        lastSyncDate: 1789664400,
      },
    ]);
  });

  it("biome devices exit 3 is no Full Disk Access", async () => {
    // Given: biome devices exited 3 without Full Disk Access
    // When
    const { exit } = await runHelperProcess(
      (helper) => helper.biomeDevices("/h"),
      "",
      3,
      "full disk access needed\n",
    );
    // Then
    expect(failure(exit)).toMatchObject({ _tag: "NoFullDiskAccessError" });
  });

  it("biome devices exit 5 is an unreadable device list", async () => {
    // Given: biome devices exited 5 on a locked DevicePeer table
    // When
    const { exit } = await runHelperProcess(
      (helper) => helper.biomeDevices("/h"),
      "",
      5,
      "cannot read DevicePeer: locked\n",
    );
    // Then
    expect(failure(exit)).toMatchObject({
      _tag: "DeviceListUnreadableError",
      reason: "cannot read DevicePeer: locked",
    });
  });

  it("biome devices exit 2 is Helper failed with the code and stderr", async () => {
    // Given: biome devices exited 2 with the usage text
    // When
    const { exit } = await runHelperProcess(
      (helper) => helper.biomeDevices("/h"),
      "",
      2,
      "usage: clocktrace-helper\n",
    );
    // Then
    const error = failure(exit);
    expect({
      tag: error instanceof Error && "_tag" in error && error._tag,
      code: error instanceof HelperFailedError && error.code,
      message: error instanceof Error && error.message,
    }).toEqual({
      tag: "HelperFailedError",
      code: 2,
      message: "helper failed with exit code 2: usage: clocktrace-helper",
    });
  });
});

const R3_LINE =
  '{"bundleId":"com.apple.mobilesafari","device":"00000000-0000-4000-8000-000000000002","focus":"start","offset":184,"segment":"000000000000001","ts":1789833660,"appVersion":null,"build":null,"reason":null}';
const R3 = {
  device: "00000000-0000-4000-8000-000000000002",
  ts: 1789833660,
  focus: "start",
  bundleId: "com.apple.mobilesafari",
  reason: null,
  appVersion: null,
  build: null,
  segment: "000000000000001",
  offset: 184,
};

describe("Helper biome records", () => {
  it("biome records exit 0 gives decoded records and parse lines", async () => {
    // Given: biome records printed one record and one parse error line
    const stdout = `${R3_LINE}\n{"error":"parse","offset":148,"segment":"000000000000001"}\n`;
    // When
    const { exit } = await runHelperProcess(
      (helper) => helper.biomeRecords("/h", new Map()),
      stdout,
    );
    // Then
    expect(Exit.isSuccess(exit) && exit.value).toEqual([
      R3,
      { error: "parse", segment: "000000000000001", offset: 148 },
    ]);
  });

  it("biome records exit 3 is no Full Disk Access", async () => {
    // Given: biome records exited 3 without Full Disk Access
    // When
    const { exit } = await runHelperProcess(
      (helper) => helper.biomeRecords("/h", new Map()),
      "",
      3,
      "full disk access needed\n",
    );
    // Then
    expect(failure(exit)).toMatchObject({ _tag: "NoFullDiskAccessError" });
  });

  it("biome records exit 4 is no Biome folder", async () => {
    // Given: biome records exited 4 without the remote folder
    // When
    const { exit } = await runHelperProcess(
      (helper) => helper.biomeRecords("/h", new Map()),
      "",
      4,
      "no App.InFocus remote folder\n",
    );
    // Then
    expect(failure(exit)).toMatchObject({
      _tag: "NoBiomeFolderError",
      reason: "no App.InFocus remote folder",
    });
  });

  it("biome records exit 6 keeps the records and names the reason", async () => {
    // Given: biome records printed R3, then exited 6 on the iPad folder
    // When
    const { exit } = await runHelperProcess(
      (helper) => helper.biomeRecords("/h", new Map()),
      `${R3_LINE}\n`,
      6,
      "cannot list iPad folder\n",
    );
    // Then
    expect(failure(exit)).toMatchObject({
      _tag: "FoldersUnreadableError",
      reason: "cannot list iPad folder",
      records: [R3],
    });
  });

  it("biome records rejects a line that is not a record", async () => {
    // Given: biome records printed a line whose shape matches no Biome line
    // When
    const { exit } = await runHelperProcess(
      (helper) => helper.biomeRecords("/h", new Map()),
      '{"app":"Safari"}\n',
    );
    // Then
    expect(failure(exit)).toMatchObject({ _tag: "ParseError" });
  });
});

describe("Helper shared sample files", () => {
  it("biome records decodes every line of infocus.expected.jsonl", async () => {
    // Given: biome records printed the shared Biome records sample and exited 0
    const stdout = sharedSample("infocus.expected.jsonl");
    // When
    const { exit } = await runHelperProcess(
      (helper) => helper.biomeRecords("/h", new Map()),
      stdout,
    );
    // Then
    expect({
      success: Exit.isSuccess(exit),
      count: Exit.isSuccess(exit) ? exit.value.length : 0,
    }).toEqual({ success: true, count: 3 });
  });

  it("watch decodes every line of watch.expected.jsonl", async () => {
    // Given: watch printed the shared watch sample
    const stdout = sharedSample("watch.expected.jsonl");
    // When
    const { exit, logs } = await runHelperProcess(
      (helper) => helper.lines("/h").pipe(Stream.take(5), Stream.runCollect),
      stdout,
    );
    // Then
    expect({
      count: Exit.isSuccess(exit) ? Chunk.size(exit.value) : 0,
      logs,
    }).toEqual({ count: 5, logs: [] });
  });

  it("permissions decodes every line of permissions.expected.jsonl", async () => {
    // Given: each line of the shared permissions sample as the Helper's answer
    const answers = sharedSample("permissions.expected.jsonl")
      .trim()
      .split("\n");
    // When
    const results = await Promise.all(
      answers.map((answer) =>
        runHelper((helper) => helper.permissions("/x/Clocktrace.app"), answer),
      ),
    );
    // Then
    expect(results.map(({ exit }) => Exit.isSuccess(exit))).toEqual([
      true,
      true,
    ]);
  });

  it("biome devices decodes every line of devices.expected.jsonl", async () => {
    // Given: biome devices printed the shared device sample and exited 0
    const stdout = sharedSample("devices.expected.jsonl");
    // When
    const { exit } = await runHelperProcess(
      (helper) => helper.biomeDevices("/h"),
      stdout,
    );
    // Then
    expect({
      success: Exit.isSuccess(exit),
      count: Exit.isSuccess(exit) ? exit.value.length : 0,
    }).toEqual({ success: true, count: 3 });
  });
});

describe("openArgs", () => {
  it("openArgs builds the open command for a permissions read", () => {
    // Given: an app path and capture files
    // When
    const args = openArgs("/x/Clocktrace.app", "/tmp/o", "/tmp/e", [
      "permissions",
    ]);
    // Then
    expect(args).toEqual([
      "-W",
      "-n",
      "--stdout",
      "/tmp/o",
      "--stderr",
      "/tmp/e",
      "-a",
      "/x/Clocktrace.app",
      "--args",
      "permissions",
    ]);
  });

  it("openArgs builds the open command for a request", () => {
    // Given: an app path and capture files
    // When
    const args = openArgs("/x/Clocktrace.app", "/tmp/o", "/tmp/e", [
      "permissions",
      "request",
      "fulldiskaccess",
    ]);
    // Then
    expect(args).toEqual([
      "-W",
      "-n",
      "--stdout",
      "/tmp/o",
      "--stderr",
      "/tmp/e",
      "-a",
      "/x/Clocktrace.app",
      "--args",
      "permissions",
      "request",
      "fulldiskaccess",
    ]);
  });
});

describe("Helper via open", () => {
  it("permissions runs open and reads the stdout file", async () => {
    // Given: open exits 0 and the Helper prints its grants on captured stdout
    const grants =
      '{"accessibility":"granted","automation":{},"fullDiskAccess":"denied"}';
    // When
    const { exit, commands } = await runHelper(
      (helper) => helper.permissions("/x/Clocktrace.app"),
      grants,
    );
    // Then
    expect(Exit.isSuccess(exit) && exit.value).toEqual({
      accessibility: "granted",
      automation: {},
      fullDiskAccess: "denied",
    });
    expect(commands[0]).toEqual([
      "open",
      "-W",
      "-n",
      "--stdout",
      expect.any(String),
      "--stderr",
      expect.any(String),
      "-a",
      "/x/Clocktrace.app",
      "--args",
      "permissions",
    ]);
  });

  it("request reads the outcome line", async () => {
    // Given: the Helper reports notRunning on captured stdout
    // When
    const { exit } = await runHelper(
      (helper) =>
        helper.request("/x/Clocktrace.app", { kind: "fullDiskAccess" }),
      '{"outcome":"notRunning"}',
    );
    // Then
    expect(Exit.isSuccess(exit) && exit.value).toBe("notRunning");
  });

  it("request reads the outcome line when open exits non-zero", async () => {
    // Given: open -W lost the race and exits 1, but the Helper wrote asked
    // When
    const { exit } = await runHelper(
      (helper) =>
        helper.request("/x/Clocktrace.app", { kind: "fullDiskAccess" }),
      '{"outcome":"asked"}',
      1,
    );
    // Then
    expect(Exit.isSuccess(exit) && exit.value).toBe("asked");
  });

  it("open exiting non-zero fails with HelperExitedError", async () => {
    // Given: open exits 5
    // When
    const { exit } = await runHelper(
      (helper) => helper.permissions("/x/Clocktrace.app"),
      "",
      5,
    );
    // Then
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("open exiting non-zero names its stderr", async () => {
    // Given: open exits 5 and macOS printed a reason on stderr
    // When
    const { exit } = await runHelper(
      (helper) => helper.permissions("/x/Clocktrace.app"),
      "",
      5,
      "the application cannot be opened\n",
    );
    // Then
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
      const error = exit.cause.error;
      expect(error instanceof HelperExitedError && error.message).toBe(
        "helper exited: the application cannot be opened",
      );
    } else {
      expect.unreachable("expected HelperExitedError");
    }
  });
});

describe("Helper.Test", () => {
  const readAll = Effect.gen(function* () {
    const helper = yield* Helper;
    return {
      permissions: yield* Effect.scoped(
        helper.permissions("/x/Clocktrace.app"),
      ),
      request: yield* Effect.scoped(
        helper.request("/x/Clocktrace.app", { kind: "fullDiskAccess" }),
      ),
      devices: yield* helper.biomeDevices("/h"),
      records: yield* helper.biomeRecords("/h", new Map()),
      lines: Chunk.toReadonlyArray(
        yield* Stream.runCollect(helper.lines("/h")),
      ),
    };
  });

  it("Helper.Test gives the defaults", async () => {
    // Given: the Test Helper with no methods changed
    // When
    const result = await Effect.runPromise(
      readAll.pipe(Effect.provide(Helper.Test())),
    );
    // Then
    expect(result).toEqual({
      permissions: {
        accessibility: "granted",
        automation: {},
        fullDiskAccess: "granted",
      },
      request: "asked",
      devices: [],
      records: [],
      lines: [],
    });
  });

  it("Helper.Test keeps the defaults a test leaves out", async () => {
    // Given: the Test Helper with only request changed
    const layer = Helper.Test({ request: () => Effect.succeed("notRunning") });
    // When
    const result = await Effect.runPromise(readAll.pipe(Effect.provide(layer)));
    // Then
    expect({
      request: result.request,
      permissions: result.permissions,
    }).toEqual({
      request: "notRunning",
      permissions: {
        accessibility: "granted",
        automation: {},
        fullDiskAccess: "granted",
      },
    });
  });
});
