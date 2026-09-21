import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  entryPath,
  fakeLaunchd,
  Helper,
  HelperNotFoundError,
  type LaunchdState,
  type Permissions,
  plistPath,
} from "@clocktrace/collector";
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

import { fakePrompt } from "../src/prompt.js";
import { setup } from "../src/setup.js";

const allGranted: Permissions = {
  accessibility: "granted",
  automation: {},
  fullDiskAccess: "granted",
};

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

describe("setup", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clocktrace-"));
    path = join(dir, "clocktrace.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const run = (
    helperLayer: Layer.Layer<Helper>,
    launchdState: LaunchdState,
    helperPath = "/stub",
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const prompt = yield* fakePrompt([], false);
        const state = yield* Ref.make(launchdState);
        const layers = Layer.mergeAll(
          prompt.layer,
          fakeLaunchd(state),
          helperLayer,
          NodeContext.layer,
        );
        const exit = yield* Effect.exit(setup().pipe(Effect.provide(layers)));
        return {
          exit,
          output: yield* Ref.get(prompt.output),
          state: yield* Ref.get(state),
        };
      }).pipe(
        Effect.withConfigProvider(
          ConfigProvider.fromMap(
            new Map([
              ["CLOCKTRACE_HELPER", helperPath],
              ["CLOCKTRACE_DB", path],
            ]),
          ),
        ),
        DateTime.withCurrentZoneNamed("America/Los_Angeles"),
      ),
    );

  const expectedWalk = () => [
    "accessibility: window titles",
    "  denied: window titles are not tracked",
    "accessibility: granted",
    "full disk access: iPhone and iPad import",
    "  denied: iPhone and iPad time is not imported",
    "full disk access: granted",
    "collector: running",
    "accessibility: granted",
    "full disk access: granted",
    "last activity: none yet",
    `database: ${path}`,
    "next: register with your AI app",
  ];

  it("setup creates the database, installs the Collector, walks the permissions, and ends with next", async () => {
    // Given: no plist and no database file
    // When
    const { exit, output, state } = await run(helperStub(allGranted), {
      installed: false,
      running: false,
      plist: null,
      installs: 0,
    });
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual([
      `launchd agent: written ${plistPath}`,
      ...expectedWalk(),
    ]);
    expect(existsSync(path)).toBe(true);
    expect(state.installed).toBe(true);
    expect(state.running).toBe(true);
    expect(state.installs).toBe(1);
    expect(state.plist).toContain(`<string>${process.execPath}</string>`);
    expect(state.plist).toContain(`<string>${entryPath}</string>`);
    expect(state.plist).toContain(`<string>${path}</string>`);
    expect(state.plist).toContain("<string>/stub</string>");
  });

  it("setup again keeps the database and the agent and runs only permissions", async () => {
    // Given: one setup already run
    const first = await run(helperStub(allGranted), {
      installed: false,
      running: false,
      plist: null,
      installs: 0,
    });
    // When
    const second = await run(helperStub(allGranted), first.state);
    // Then
    expect(Exit.isSuccess(second.exit)).toBe(true);
    expect(second.output).toEqual(expectedWalk());
    expect(second.state.installs).toBe(1);
    expect(existsSync(path)).toBe(true);
  });

  it("setup fails when the helper binary is missing", async () => {
    // Given: CLOCKTRACE_HELPER points at a path that does not exist
    // When
    const { exit, output, state } = await run(
      Helper.Default,
      { installed: false, running: false, plist: null, installs: 0 },
      "/nope/clocktrace-helper",
    );
    // Then
    expect(exit).toEqual(
      Exit.fail(new HelperNotFoundError({ path: "/nope/clocktrace-helper" })),
    );
    expect(existsSync(path)).toBe(false);
    expect(state.installs).toBe(0);
    expect(output).toEqual([]);
  });
});
