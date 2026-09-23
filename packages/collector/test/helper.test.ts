import { writeFileSync } from "node:fs";

import { CommandExecutor } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import {
  Chunk,
  DateTime,
  Effect,
  Either,
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
  biomeResult,
  Helper,
  HelperExitedError,
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

  it("biomeResult returns the lines on exit 0", () => {
    // Given: a biome command that printed two lines and a blank
    // When
    const result = biomeResult(0, ["a", "b", ""], "");
    // Then
    expect(Either.getOrThrow(result)).toEqual(["a", "b"]);
  });

  it("biomeResult names the exit code and stderr", () => {
    // Given: a biome command that exited 4 with a reason on stderr
    // When
    const result = biomeResult(4, [], "no App.InFocus remote folder\n");
    // Then
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("BiomeExitError");
      expect(result.left.message).toBe(
        "helper biome exited 4: no App.InFocus remote folder",
      );
    }
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
