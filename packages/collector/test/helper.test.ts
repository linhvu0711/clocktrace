import { writeFileSync } from "node:fs";

import { CommandExecutor } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Either, Exit, Layer, Ref, type Scope, Stream } from "effect";
import { describe, expect, it } from "vitest";

import {
  biomeResult,
  Helper,
  HelperExitedError,
  openArgs,
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
});

// Answers `open` the chosen exit code after recording the command and
// writing what the Helper would have printed to the --stdout file.
const openExecutor = (
  recorded: Ref.Ref<ReadonlyArray<ReadonlyArray<string>>>,
  stdoutText: string,
  code: number = 0,
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
              openExecutor(recorded, stdoutText, code),
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
});
