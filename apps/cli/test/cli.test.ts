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
  Option,
  Ref,
  Stream,
} from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BadLimitError, parseLimit } from "../src/activities.js";
import { renderFriendly, run } from "../src/cli.js";
import { Style } from "../src/format.js";
import { Hosts } from "../src/hosts.js";
import { fakePrompt } from "../src/prompt.js";
import { NotSetUpError } from "../src/set-up.js";
import { version } from "../src/version.js";
import { MissingWindowError } from "../src/window.js";
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
          Style.Test,
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

  it("rules list before setup fails not set up", async () => {
    // Given: the launchd agent is not installed, no database file
    const argv = ["node", "clocktrace", "rules", "list"];
    // When
    const { exit } = await runArgv(argv);
    // Then
    expect(exit).toEqual(Exit.fail(new NotSetUpError({ dbPath: path })));
  });

  it("categories list before setup fails not set up", async () => {
    // Given: the launchd agent is not installed, no database file
    const argv = ["node", "clocktrace", "categories", "list"];
    // When
    const { exit } = await runArgv(argv);
    // Then
    expect(exit).toEqual(Exit.fail(new NotSetUpError({ dbPath: path })));
  });

  it("projects list before setup fails not set up", async () => {
    // Given: the launchd agent is not installed, no database file
    const argv = ["node", "clocktrace", "projects", "list"];
    // When
    const { exit } = await runArgv(argv);
    // Then
    expect(exit).toEqual(Exit.fail(new NotSetUpError({ dbPath: path })));
  });

  it("a bad compare is a validation error", async () => {
    // Given
    const argv = [
      "node",
      "clocktrace",
      "rules",
      "add",
      "--field",
      "url",
      "--compare",
      "bogus",
      "--value",
      "x",
      "--effect",
      "private",
    ];
    // When
    const { exit } = await runArgv(argv);
    // Then
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
      expect(ValidationError.isValidationError(exit.cause.error)).toBe(true);
    }
  });

  it("a missing flag is a validation error", async () => {
    // Given
    const argv = ["node", "clocktrace", "rules", "add", "--field", "url"];
    // When
    const { exit } = await runArgv(argv);
    // Then
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
      expect(ValidationError.isValidationError(exit.cause.error)).toBe(true);
    }
  });

  it("an unknown group is a validation error", async () => {
    // Given
    const argv = [
      "node",
      "clocktrace",
      "summary",
      "--from",
      "2026-09-18",
      "--to",
      "2026-09-18",
      "--group-by",
      "week",
    ];
    // When
    const { exit } = await runArgv(argv);
    // Then
    expect(exit).toEqual(
      Exit.fail(
        ValidationError.invalidValue(
          HelpDoc.p(
            "Expected one of the following cases: category, project, app, device",
          ),
        ),
      ),
    );
  });

  it("summary before setup fails not set up", async () => {
    // Given: the launchd agent is not installed, no database file
    const argv = [
      "node",
      "clocktrace",
      "summary",
      "--from",
      "2026-09-18",
      "--to",
      "2026-09-18",
    ];
    // When
    const { exit } = await runArgv(argv);
    // Then
    expect(exit).toEqual(Exit.fail(new NotSetUpError({ dbPath: path })));
  });

  it("timeline before setup fails not set up", async () => {
    // Given: the launchd agent is not installed, no database file
    const argv = [
      "node",
      "clocktrace",
      "timeline",
      "--from",
      "2026-09-18",
      "--to",
      "2026-09-18",
    ];
    // When
    const { exit } = await runArgv(argv);
    // Then
    expect(exit).toEqual(Exit.fail(new NotSetUpError({ dbPath: path })));
  });

  it("activities before setup fails not set up", async () => {
    // Given: the launchd agent is not installed, no database file
    const argv = [
      "node",
      "clocktrace",
      "activities",
      "--from",
      "2026-09-18",
      "--to",
      "2026-09-18",
    ];
    // When
    const { exit } = await runArgv(argv);
    // Then
    expect(exit).toEqual(Exit.fail(new NotSetUpError({ dbPath: path })));
  });

  it("a known command dispatches", async () => {
    // Given: the launchd agent is not installed, no database file
    const argv = ["node", "clocktrace", "status"];
    // When
    const { exit } = await runArgv(argv);
    // Then
    expect(exit).toEqual(Exit.fail(new NotSetUpError({ dbPath: path })));
  });

  it("help lists every command with its description", async () => {
    // Given
    const argv = ["node", "clocktrace", "--help"];
    // When
    const { exit, lines } = await runArgv(argv);
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    const text = lines.join("\n");
    for (const desc of [
      "install the collector and register your AI hosts",
      "start the collector",
      "stop the collector",
      "show whether the collector is running",
      "check the macOS permissions the collector needs",
      "start the MCP server for AI hosts",
      "list, add, or remove classification rules",
      "list, set, or remove categories",
      "list, set, or remove projects",
      "show time summed by category, project, app, or device",
      "show a timeline of activity blocks",
      "list raw activities",
    ]) {
      expect(text).toContain(desc);
    }
  });

  it("an unknown command still lists the commands", async () => {
    // Given
    const argv = ["node", "clocktrace", "nosuchcommand"];
    // When
    const { exit, lines } = await runArgv(argv);
    // Then
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
      expect(ValidationError.isValidationError(exit.cause.error)).toBe(true);
    }
    const text = lines.join("\n");
    expect(text).toContain("setup");
    expect(text).toContain("summary");
  });

  it("setup help describes --hosts", async () => {
    // Given
    const argv = ["node", "clocktrace", "setup", "--help"];
    // When
    const { exit, lines } = await runArgv(argv);
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(lines.join("\n")).toContain(
      "register these hosts without the checklist: claude, codex, hermes, openclaw",
    );
  });

  it("rules add help describes each option", async () => {
    // Given
    const argv = ["node", "clocktrace", "rules", "add", "--help"];
    // When
    const { exit, lines } = await runArgv(argv);
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    const text = lines.join("\n");
    for (const desc of [
      "the Activity field to test",
      "the text to compare against",
      "what a matching Activity gets",
      "the category or project id, for a set effect",
      'quote a value that holds a space: --compare "ends with"',
    ]) {
      expect(text).toContain(desc);
    }
  });

  it("categories set help describes each option", async () => {
    // Given
    const argv = ["node", "clocktrace", "categories", "set", "--help"];
    // When
    const { exit, lines } = await runArgv(argv);
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    const text = lines.join("\n");
    for (const desc of [
      "the category name",
      "true or false; on an update, leaving it out keeps the current value",
      "the category id to update; omit to create",
    ]) {
      expect(text).toContain(desc);
    }
  });

  it("projects set help describes each option", async () => {
    // Given
    const argv = ["node", "clocktrace", "projects", "set", "--help"];
    // When
    const { exit, lines } = await runArgv(argv);
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    const text = lines.join("\n");
    for (const desc of [
      "the project name",
      "the project id to update; omit to create",
    ]) {
      expect(text).toContain(desc);
    }
  });

  it("shared option descriptions read plainly", async () => {
    // Given
    const argv = ["node", "clocktrace", "summary", "--help"];
    // When
    const { exit, lines } = await runArgv(argv);
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    const text = lines.join("\n");
    expect(text).toContain(
      "print JSON for scripts, the same shape the MCP tool returns",
    );
    expect(text).toContain("a Device id, see summary --group-by device");
    expect(text).toContain("how to group the rows");
    expect(text).toContain(
      "One of the following: category, project, app, device",
    );
  });

  it("renderFriendly explains a missing window", () => {
    // Given / When / Then
    expect(
      renderFriendly(new MissingWindowError({ command: "summary" })),
    ).toEqual([
      "summary needs --from and --to.",
      "example:  clocktrace summary --from YYYY-MM-DD --to YYYY-MM-DD",
    ]);
  });

  it("renderFriendly names each command", () => {
    // Given / When / Then
    expect(
      renderFriendly(new MissingWindowError({ command: "timeline" }))[0],
    ).toBe("timeline needs --from and --to.");
    expect(
      renderFriendly(new MissingWindowError({ command: "activities" }))[0],
    ).toBe("activities needs --from and --to.");
  });

  it("summary with no window explains itself", async () => {
    // Given
    const argv = ["node", "clocktrace", "summary"];
    // When
    const { exit, lines } = await runArgv(argv);
    // Then
    expect(exit).toEqual(
      Exit.fail(new MissingWindowError({ command: "summary" })),
    );
    const text = lines.join("\n");
    expect(text).toContain("summary needs --from and --to.");
    expect(text).toContain("example:  clocktrace summary --from");
  });

  it("timeline with no window explains itself", async () => {
    // Given
    const argv = ["node", "clocktrace", "timeline"];
    // When
    const { exit, lines } = await runArgv(argv);
    // Then
    expect(exit).toEqual(
      Exit.fail(new MissingWindowError({ command: "timeline" })),
    );
    expect(lines.join("\n")).toContain("timeline needs --from and --to.");
  });

  it("activities with no window explains itself", async () => {
    // Given
    const argv = ["node", "clocktrace", "activities"];
    // When
    const { exit, lines } = await runArgv(argv);
    // Then
    expect(exit).toEqual(
      Exit.fail(new MissingWindowError({ command: "activities" })),
    );
    expect(lines.join("\n")).toContain("activities needs --from and --to.");
  });

  it("parseLimit reads a whole number", () => {
    expect(Effect.runSync(parseLimit(Option.some("5")))).toEqual(
      Option.some(5),
    );
  });

  it("parseLimit rejects a non-number", () => {
    expect(Effect.runSyncExit(parseLimit(Option.some("notanumber")))).toEqual(
      Exit.fail(new BadLimitError()),
    );
  });

  it("parseLimit passes none through", () => {
    expect(Effect.runSync(parseLimit(Option.none()))).toEqual(Option.none());
  });

  it("parseLimit rejects an empty or non-positive limit", () => {
    for (const bad of ["", "   ", "0", "-3"]) {
      expect(Effect.runSyncExit(parseLimit(Option.some(bad)))).toEqual(
        Exit.fail(new BadLimitError()),
      );
    }
  });

  it("a bad --limit is named", async () => {
    // Given
    const argv = ["node", "clocktrace", "activities", "--limit", "notanumber"];
    // When
    const { exit, lines } = await runArgv(argv);
    // Then
    expect(exit).toEqual(Exit.fail(new BadLimitError()));
    const text = lines.join("\n");
    expect(text).toContain("--limit");
    expect(text).toContain("a whole number");
  });
});
