import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fakeLaunchd,
  Helper,
  type LaunchdState,
  type Permissions,
} from "@clocktrace/collector";
import * as HelpDoc from "@effect/cli/HelpDoc";
import * as ValidationError from "@effect/cli/ValidationError";
import { NodeContext } from "@effect/platform-node";
import {
  ConfigProvider,
  Console,
  DateTime,
  Effect,
  Exit,
  Layer,
  Ref,
  Stream,
} from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { run } from "../src/cli.js";
import { Hosts } from "../src/hosts.js";
import { fakePrompt } from "../src/prompt.js";
import { NotSetUpError } from "../src/set-up.js";
import { version } from "../src/version.js";
import * as MockConsole from "./mock-console.js";

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

const allGranted: Permissions = {
  accessibility: "granted",
  automation: {},
  fullDiskAccess: "granted",
};

describe("cli", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clocktrace-"));
    path = join(dir, "clocktrace.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const runArgv = (
    argv: ReadonlyArray<string>,
    launchdState: LaunchdState = {
      installed: false,
      running: false,
      plist: null,
      installs: 0,
    },
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const prompt = yield* fakePrompt([], false);
        const console = yield* MockConsole.make;
        const state = yield* Ref.make(launchdState);
        const layers = Layer.mergeAll(
          Console.setConsole(console),
          NodeContext.layer,
          prompt.layer,
          fakeLaunchd(state),
          helperStub(allGranted),
          Hosts.Test,
        );
        const exit = yield* Effect.exit(
          run([...argv]).pipe(Effect.provide(layers)),
        );
        const lines = yield* console.getLines({ stripAnsi: true });
        return { exit, lines };
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

  it("help lists the six commands", async () => {
    // Given
    const argv = ["node", "clocktrace", "--help"];
    // When
    const { exit, lines } = await runArgv(argv);
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    const text = lines.join("\n");
    for (const name of [
      "setup",
      "start",
      "stop",
      "status",
      "permissions",
      "mcp",
    ]) {
      expect(text).toContain(name);
    }
  });

  it("a command's help is generated", async () => {
    // Given
    const argv = ["node", "clocktrace", "status", "--help"];
    // When
    const { exit, lines } = await runArgv(argv);
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(lines.join("\n")).toContain("status");
  });

  it("version prints the package version", async () => {
    // Given
    const argv = ["node", "clocktrace", "--version"];
    // When
    const { exit, lines } = await runArgv(argv);
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(lines.join("\n")).toContain(version());
  });

  it("the short version flag prints the package version", async () => {
    // Given
    const argv = ["node", "clocktrace", "-v"];
    // When
    const { exit, lines } = await runArgv(argv);
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(lines.join("\n")).toContain(version());
  });

  it("an unknown command is a validation error", async () => {
    // Given
    const argv = ["node", "clocktrace", "bogus"];
    // When
    const { exit } = await runArgv(argv);
    // Then
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
      expect(ValidationError.isValidationError(exit.cause.error)).toBe(true);
    }
  });

  it("a stray word is rejected", async () => {
    // Given
    const argv = ["node", "clocktrace", "status", "extra"];
    // When
    const { exit } = await runArgv(argv);
    // Then
    expect(exit).toEqual(
      Exit.fail(
        ValidationError.invalidValue(
          HelpDoc.p("Received unknown argument: 'extra'"),
        ),
      ),
    );
  });

  it("a known command dispatches", async () => {
    // Given: the launchd agent is not installed, no database file
    const argv = ["node", "clocktrace", "status"];
    // When
    const { exit } = await runArgv(argv);
    // Then
    expect(exit).toEqual(Exit.fail(new NotSetUpError()));
  });
});
