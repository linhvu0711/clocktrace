import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fakeLaunchd,
  Helper,
  HelperExitedError,
  type Launchd,
  type LaunchdState,
  type Permissions,
} from "@clocktrace/collector";
import { openStore } from "@clocktrace/core";
import { NodeContext } from "@effect/platform-node";
import {
  ConfigProvider,
  DateTime,
  Effect,
  Exit,
  Layer,
  Ref,
  Stream,
} from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { fakePrompt, type Prompt } from "../src/prompt.js";
import { NotSetUpError } from "../src/set-up.js";
import { status } from "../src/status.js";

const helperStub = (p: Permissions) =>
  Layer.succeed(
    Helper,
    new Helper({
      check: () => Effect.void,
      lines: () => Stream.empty,
      permissions: () => Effect.succeed(p),
      request: () => Effect.succeed("asked"),
    }),
  );

const helperExits = (cause: unknown) =>
  Layer.succeed(
    Helper,
    new Helper({
      check: () => Effect.void,
      lines: () => Stream.empty,
      permissions: () => Effect.fail(new HelperExitedError({ cause })),
      request: () => Effect.succeed("asked"),
    }),
  );

const allGranted: Permissions = {
  accessibility: "granted",
  automation: {},
  fullDiskAccess: "granted",
};

describe("status", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clocktrace-"));
    path = join(dir, "clocktrace.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const run = <A, E>(
    p: Permissions,
    launchdState: LaunchdState,
    command: Effect.Effect<
      A,
      E,
      | Prompt
      | Launchd
      | Helper
      | import("@effect/platform").FileSystem.FileSystem
      | DateTime.CurrentTimeZone
    >,
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const prompt = yield* fakePrompt([], true);
        const state = yield* Ref.make(launchdState);
        const layers = Layer.mergeAll(
          prompt.layer,
          fakeLaunchd(state),
          helperStub(p),
          NodeContext.layer,
        );
        const exit = yield* Effect.exit(command.pipe(Effect.provide(layers)));
        const output = yield* Ref.get(prompt.output);
        return { exit, output, state: yield* Ref.get(state) };
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

  it("status fails not set up when nothing is installed", async () => {
    // Given: no plist and no database file
    // When
    const { exit } = await run(
      allGranted,
      { installed: false, running: false, plist: null, installs: 0 },
      status(),
    );
    // Then
    expect(exit).toEqual(Exit.fail(new NotSetUpError()));
    if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
      expect((exit.cause.error as NotSetUpError).message).toBe(
        "not set up, run clocktrace setup",
      );
    }
    expect(existsSync(path)).toBe(false);
  });

  it("status names a Helper failure", async () => {
    // Given: set up (installed, running, database) and the Helper exits with an error
    await Effect.runPromise(Effect.scoped(openStore(path)));
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const prompt = yield* fakePrompt([], true);
        const state = yield* Ref.make<LaunchdState>({
          installed: true,
          running: true,
          plist: null,
          installs: 0,
        });
        const layers = Layer.mergeAll(
          prompt.layer,
          fakeLaunchd(state),
          helperExits("boom"),
          NodeContext.layer,
        );
        return yield* Effect.exit(status().pipe(Effect.provide(layers)));
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
    // Then: the failure surfaces as a non-empty line naming the Helper
    expect(exit).toEqual(Exit.fail(new HelperExitedError({ cause: "boom" })));
    if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
      const message = (exit.cause.error as HelperExitedError).message;
      expect(message).toBe("helper exited: boom");
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it("status prints the view when set up", async () => {
    // Given: the plist installed, the collector running, the database file
    await Effect.runPromise(Effect.scoped(openStore(path)));
    // When
    const { exit, output } = await run(
      allGranted,
      { installed: true, running: true, plist: null, installs: 0 },
      status(),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual([
      "collector: running",
      "accessibility: granted",
      "full disk access: granted",
      "last activity: none yet",
      `database: ${path}`,
    ]);
  });

  it("status --json prints the status tool's JSON", async () => {
    // Given: the plist installed, the collector running, the database file
    await Effect.runPromise(Effect.scoped(openStore(path)));
    // When
    const { exit, output } = await run(
      allGranted,
      { installed: true, running: true, plist: null, installs: 0 },
      status(true),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output.length).toBe(1);
    expect(JSON.parse(output[0] ?? "")).toEqual({
      collector: "running",
      permissions: [
        { name: "accessibility", state: "granted", note: null },
        { name: "full disk access", state: "granted", note: null },
      ],
      lastActivity: null,
      databasePath: path,
    });
  });
});
