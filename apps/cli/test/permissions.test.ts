import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fakeLaunchd,
  type GrantRequest,
  Helper,
  type LaunchdState,
  type Permissions,
  type RequestOutcome,
} from "@clocktrace/collector";
import { openStore } from "@clocktrace/core";
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

import { permissions } from "../src/permissions.js";
import { Prompt, StoppedError } from "../src/prompt.js";
import { NotSetUpError } from "../src/set-up.js";
import * as MockConsole from "./mock-console.js";
import * as MockTerminal from "./mock-terminal.js";

type Key = { readonly key: string; readonly ctrl?: boolean } | string;

describe("permissions", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "clocktrace-"));
    path = join(dir, "clocktrace.db");
    await Effect.runPromise(Effect.scoped(openStore(path)));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const run = (
    p: Permissions,
    launchdState: LaunchdState,
    keys: ReadonlyArray<Key>,
    interactive: boolean,
    outcome: RequestOutcome = "asked",
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const requests = yield* Ref.make<ReadonlyArray<GrantRequest>>([]);
        const terminal = yield* MockTerminal.make(interactive);
        const console = yield* MockConsole.make;
        const state = yield* Ref.make(launchdState);
        for (const k of keys) {
          yield* typeof k === "string"
            ? terminal.inputText(k)
            : terminal.inputKey(
                k.key,
                k.ctrl === undefined ? {} : { ctrl: k.ctrl },
              );
        }
        const helper = Layer.succeed(
          Helper,
          new Helper({
            check: () => Effect.void,
            lines: () => Stream.empty,
            permissions: () => Effect.succeed(p),
            request: (_path, grant) =>
              Ref.update(requests, (rs) => [...rs, grant]).pipe(
                Effect.as(outcome),
              ),
          }),
        );
        const layers = Layer.mergeAll(
          Console.setConsole(console),
          NodeContext.layer,
          terminal.layer,
          Prompt.Default,
          fakeLaunchd(state),
          helper,
        );
        const exit = yield* Effect.exit(
          permissions().pipe(Effect.provide(layers)),
        );
        return {
          exit,
          output: yield* console.getLines({ stripAnsi: true }),
          shown: yield* terminal.shown,
          requests: yield* Ref.get(requests),
        };
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

  const installedRunning: LaunchdState = {
    installed: true,
    running: true,
    plist: null,
    installs: 0,
  };

  it("explains each permission, asks grant or skip, and ends with the status view", async () => {
    // Given: accessibility denied, Safari granted, full disk access notAsked
    // When
    const { exit, output, shown, requests } = await run(
      {
        accessibility: "denied",
        automation: { "com.apple.Safari": "granted" },
        fullDiskAccess: "notAsked",
      },
      installedRunning,
      ["grant", { key: "enter" }, "skip", { key: "enter" }],
      true,
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual([
      "accessibility: window titles",
      "  denied: window titles are not tracked",
      "accessibility: asked, answer the macOS prompt",
      "automation Safari: URLs in Safari",
      "  denied: URLs in Safari are not tracked",
      "automation Safari: granted",
      "full disk access: iPhone and iPad import",
      "  denied: iPhone and iPad time is not imported",
      "full disk access: skipped, iPhone and iPad time is not imported",
      "collector: running",
      "accessibility: denied, window titles are not tracked",
      "automation Safari: granted",
      "full disk access: denied, iPhone and iPad time is not imported",
      "last activity: none yet",
      `database: ${path}`,
    ]);
    expect(shown).toContain("grant or skip?");
    expect(requests).toEqual([{ kind: "accessibility" }]);
  });

  it("no TTY skips every answer and still prints the status view", async () => {
    // Given: the same grants, no TTY
    // When
    const { exit, output, shown, requests } = await run(
      {
        accessibility: "denied",
        automation: { "com.apple.Safari": "granted" },
        fullDiskAccess: "notAsked",
      },
      installedRunning,
      [],
      false,
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual([
      "accessibility: window titles",
      "  denied: window titles are not tracked",
      "accessibility: skipped, window titles are not tracked",
      "automation Safari: URLs in Safari",
      "  denied: URLs in Safari are not tracked",
      "automation Safari: granted",
      "full disk access: iPhone and iPad import",
      "  denied: iPhone and iPad time is not imported",
      "full disk access: skipped, iPhone and iPad time is not imported",
      "collector: running",
      "accessibility: denied, window titles are not tracked",
      "automation Safari: granted",
      "full disk access: denied, iPhone and iPad time is not imported",
      "last activity: none yet",
      `database: ${path}`,
    ]);
    expect(shown).not.toContain("grant or skip?");
    expect(requests).toEqual([]);
  });

  it("a browser that is not running prints the retry line", async () => {
    // Given: Safari not running; its request answers notRunning
    // When
    const { exit, output } = await run(
      {
        accessibility: "granted",
        automation: { "com.apple.Safari": "notRunning" },
        fullDiskAccess: "granted",
      },
      installedRunning,
      ["grant", { key: "enter" }],
      true,
      "notRunning",
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toContain("  denied: URLs in Safari are not tracked");
    expect(output).toContain(
      "automation Safari: Safari is not running, open it and retry",
    );
  });

  it("ctrl-c at a permission question stops the walk", async () => {
    // Given: accessibility denied, Safari granted, full disk access notAsked
    // When
    const { exit, output, requests } = await run(
      {
        accessibility: "denied",
        automation: { "com.apple.Safari": "granted" },
        fullDiskAccess: "notAsked",
      },
      installedRunning,
      [{ key: "c", ctrl: true }],
      true,
    );
    // Then
    expect(exit).toEqual(Exit.fail(new StoppedError()));
    expect(requests).toEqual([]);
    expect(output).toEqual([
      "accessibility: window titles",
      "  denied: window titles are not tracked",
    ]);
  });

  it("permissions before setup fails not set up", async () => {
    // Given: no plist
    // When
    const { exit, output } = await run(
      {
        accessibility: "denied",
        automation: {},
        fullDiskAccess: "denied",
      },
      { installed: false, running: false, plist: null, installs: 0 },
      [],
      true,
    );
    // Then
    expect(exit).toEqual(Exit.fail(new NotSetUpError({ dbPath: path })));
    expect(output).toEqual([]);
  });
});
