import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  App,
  AppMissingError,
  CollectorPaths,
  collectorPaths,
  fakeLaunchd,
  type GrantRequest,
  Helper,
  HelperExitedError,
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
} from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Style } from "../src/format.js";
import { permissions } from "../src/permissions.js";
import { Prompt, Stdin } from "../src/prompt.js";
import { NotSetUpError } from "../src/set-up.js";
import * as MockConsole from "./mock-console.js";
import { type ExecResult, fakeExecutor } from "./mock-executor.js";
import * as MockTerminal from "./mock-terminal.js";

type Key = { readonly key: string; readonly ctrl?: boolean } | string;

const installedRunning: LaunchdState = {
  installed: true,
  running: true,
  plist: null,
  installs: 0,
};

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
    permissionAnswers: ReadonlyArray<Permissions>,
    keys: ReadonlyArray<Key>,
    interactive: boolean,
    options: {
      readonly launchdState?: LaunchdState;
      readonly outcome?: RequestOutcome;
      readonly requestError?: (grant: GrantRequest) => HelperExitedError | null;
      readonly appLayer?: Layer.Layer<App>;
      readonly commands?: Record<string, ExecResult>;
      readonly permissionsErrorAt?: number;
      readonly permissionsError?: HelperExitedError;
    } = {},
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const requests = yield* Ref.make<ReadonlyArray<GrantRequest>>([]);
        const answers = yield* Ref.make(permissionAnswers);
        const terminal = yield* MockTerminal.make(interactive);
        const console = yield* MockConsole.make;
        const state = yield* Ref.make(options.launchdState ?? installedRunning);
        const exec = yield* fakeExecutor(options.commands ?? {});
        for (const k of keys) {
          yield* typeof k === "string"
            ? terminal.inputText(k)
            : terminal.inputKey(
                k.key,
                k.ctrl === undefined ? {} : { ctrl: k.ctrl },
              );
        }
        const permCalls = yield* Ref.make(0);
        const helper = Helper.Test({
          permissions: () =>
            Ref.modify(permCalls, (n) => [n, n + 1]).pipe(
              Effect.flatMap((n) =>
                n === options.permissionsErrorAt
                  ? Effect.fail(
                      options.permissionsError ??
                        new HelperExitedError({ cause: "gone" }),
                    )
                  : Ref.modify(answers, (as) => {
                      const head = as[0] ?? as.at(-1);
                      if (head === undefined) {
                        throw new Error("no permission answers left");
                      }
                      return [head, as.length > 1 ? as.slice(1) : as];
                    }),
              ),
            ),
          request: (_path, grant) => {
            const error = options.requestError?.(grant) ?? null;
            return (error !== null ? Effect.fail(error) : Effect.void).pipe(
              Effect.andThen(Ref.update(requests, (rs) => [...rs, grant])),
              Effect.as(options.outcome ?? "asked"),
            );
          },
        });
        const layers = Layer.mergeAll(
          Console.setConsole(console),
          NodeContext.layer,
          terminal.layer,
          Prompt.Default,
          Stdin.Test,
          fakeLaunchd(state),
          helper,
          options.appLayer ?? App.Test,
          Style.Test,
          CollectorPaths.Test,
          exec.layer,
        );
        const exit = yield* Effect.exit(
          permissions().pipe(Effect.provide(layers)),
        );
        return {
          exit,
          output: yield* console.getLines({ stripAnsi: true }),
          shown: yield* terminal.shown,
          requests: yield* Ref.get(requests),
          commands: yield* Ref.get(exec.recorded),
          permCalls: yield* Ref.get(permCalls),
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

  it("all granted prints the group and one line per item and asks nothing", async () => {
    // Given: every item granted, nothing to ask
    // When
    const { exit, output, shown, requests } = await run(
      [
        {
          accessibility: "granted",
          automation: { "com.brave.Browser": "granted" },
          fullDiskAccess: "granted",
        },
      ],
      [],
      true,
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual([
      "Permissions   3 of 3 granted",
      "  ✔ Accessibility       window titles",
      "  ✔ Automation · Brave  URLs in Brave",
      "  ✔ Full Disk Access    iPhone and iPad import",
    ]);
    expect(shown).not.toContain("Allow");
    expect(requests).toEqual([]);
  });

  it("a browser that did not answer shows the fix and is not asked", async () => {
    // Given: Chrome running but its probe never answered; interactive, no keys
    const p: Permissions = {
      accessibility: "granted",
      automation: { "com.google.Chrome": "noAnswer" },
      fullDiskAccess: "granted",
    };
    // When
    const { exit, output, shown, requests } = await run([p], [], true);
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual([
      "Permissions   2 of 3 granted",
      "  ✔ Accessibility        window titles",
      "  ✔ Full Disk Access     iPhone and iPad import",
      "  ○ Automation · Chrome  URLs in Chrome  Chrome did not answer · quit Chrome, open it again, then run clocktrace permissions",
    ]);
    expect(shown).toBe("");
    expect(requests).toEqual([]);
  });

  it("no terminal lists every item, says skipping once, asks nothing", async () => {
    // Given: every state at once, no TTY
    const p: Permissions = {
      accessibility: "granted",
      automation: {
        "com.apple.Safari": "notRunning",
        "org.chromium.Chromium": "notAsked",
      },
      fullDiskAccess: "denied",
    };
    // When
    const { exit, output, shown, requests } = await run([p], [], false);
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual([
      "Permissions   1 of 3 granted",
      "  ✔ Accessibility     window titles",
      "  ✘ Full Disk Access  denied · turn it on in System Settings › Privacy › Full Disk Access",
      "  ○ Automation  no browser used yet",
      "no terminal, skipping questions",
    ]);
    expect(shown).toBe("");
    expect(requests).toEqual([]);
  });

  it("no terminal keeps a denied browser's fix row and resets nothing", async () => {
    // Given: Chromium and full disk access denied, no TTY
    const p: Permissions = {
      accessibility: "granted",
      automation: { "org.chromium.Chromium": "denied" },
      fullDiskAccess: "denied",
    };
    // When
    const { exit, output, shown, requests, commands } = await run(
      [p],
      [],
      false,
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(commands).toEqual([]);
    expect(requests).toEqual([]);
    expect(shown).toBe("");
    expect(output).toEqual([
      "Permissions   1 of 3 granted",
      "  ✔ Accessibility          window titles",
      "  ✘ Automation · Chromium  denied · turn it on in System Settings › Privacy › Automation",
      "  ✘ Full Disk Access       denied · turn it on in System Settings › Privacy › Full Disk Access",
      "no terminal, skipping questions",
    ]);
  });

  it("permissions with the app missing fails app missing", async () => {
    // Given: installed and running, database present, no app
    const appMissing = Layer.succeed(
      App,
      new App({
        isInstalled: () => Effect.succeed(false),
        install: () => Effect.succeed("replaced" as const),
        commit: () => Effect.void,
        rollback: () => Effect.void,
        remove: () => Effect.succeed("absent" as const),
      }),
    );
    // When
    const { exit, output } = await run(
      [
        {
          accessibility: "denied",
          automation: {},
          fullDiskAccess: "denied",
        },
      ],
      [],
      true,
      { appLayer: appMissing },
    );
    // Then
    expect(exit).toEqual(
      Exit.fail(
        new AppMissingError({ path: collectorPaths("/Users/me").appPath }),
      ),
    );
    if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
      expect((exit.cause.error as AppMissingError).message).toBe(
        "app: missing, run clocktrace setup",
      );
    }
    expect(output).toEqual([]);
  });

  it("permissions before setup fails not set up", async () => {
    // Given: no plist
    // When
    const { exit, output } = await run(
      [
        {
          accessibility: "denied",
          automation: {},
          fullDiskAccess: "denied",
        },
      ],
      [],
      true,
      {
        launchdState: {
          installed: false,
          running: false,
          plist: null,
          installs: 0,
        },
      },
    );
    // Then
    expect(exit).toEqual(Exit.fail(new NotSetUpError({ dbPath: path })));
    expect(output).toEqual([]);
  });

  it("no browser used yet counts in the total like status", async () => {
    // Given: accessibility and full disk access granted, no browser used yet
    const p: Permissions = {
      accessibility: "granted",
      automation: {},
      fullDiskAccess: "granted",
    };
    // When
    const { exit, output } = await run([p], [], true);
    // Then: the placeholder Automation row counts in the denominator, like
    // status — 2 granted out of 3, not out of 2
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual([
      "Permissions   2 of 3 granted",
      "  ✔ Accessibility     window titles",
      "  ✔ Full Disk Access  iPhone and iPad import",
      "  ○ Automation  no browser used yet",
    ]);
  });

  it("full disk access opens System Settings and re-checks on y", async () => {
    // Given
    const p = {
      accessibility: "granted" as const,
      automation: {},
      fullDiskAccess: "denied" as const,
    };
    // When
    const { exit, output, requests } = await run(
      [p, { ...p, fullDiskAccess: "granted" }],
      [{ key: "enter" }, { key: "enter" }],
      true,
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(requests).toEqual([{ kind: "fullDiskAccess" }]);
    expect(output).toEqual([
      "Permissions   1 of 3 granted",
      "  ✔ Accessibility     window titles",
      "  ○ Automation  no browser used yet",
      "  → System Settings opened, turn it on for Clocktrace",
      "  ✔ Full Disk Access  granted",
    ]);
  });

  it("accessibility opens the macOS dialog and re-checks on y", async () => {
    // Given
    const p = {
      accessibility: "denied" as const,
      automation: {},
      fullDiskAccess: "granted" as const,
    };
    // When
    const { exit, output } = await run(
      [p, { ...p, accessibility: "granted" }],
      [{ key: "enter" }, { key: "enter" }],
      true,
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual([
      "Permissions   1 of 3 granted",
      "  ✔ Full Disk Access  iPhone and iPad import",
      "  ○ Automation  no browser used yet",
      "  → macOS dialog opened, turn it on for Clocktrace",
      "  ✔ Accessibility     granted",
    ]);
  });

  it("n at the re-check prints the turn-it-on later line", async () => {
    // Given
    const p = {
      accessibility: "granted" as const,
      automation: {},
      fullDiskAccess: "denied" as const,
    };
    // When
    const { exit, output } = await run(
      [p],
      [{ key: "enter" }, "n", { key: "enter" }],
      true,
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output[output.length - 1]).toBe(
      "  ○ Full Disk Access  later: turn it on, then run clocktrace permissions",
    );
  });

  it("accessibility still denied after the ask offers the reset and asks again", async () => {
    // Given: accessibility denied; the first re-check still reads denied,
    // tccutil succeeds, the re-check after the second ask reads granted
    const p = {
      accessibility: "denied" as const,
      automation: {},
      fullDiskAccess: "granted" as const,
    };
    // When
    const { exit, output, shown, requests, commands } = await run(
      [p, p, { ...p, accessibility: "granted" }],
      [
        { key: "enter" },
        { key: "enter" },
        "y",
        { key: "enter" },
        { key: "enter" },
      ],
      true,
      {
        commands: {
          "tccutil reset Accessibility com.clocktrace.app": { code: 0 },
        },
      },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(commands).toEqual([
      "tccutil reset Accessibility com.clocktrace.app",
    ]);
    expect(requests).toEqual([
      { kind: "accessibility" },
      { kind: "accessibility" },
    ]);
    expect(shown).toContain("Still denied — reset the grant for Clocktrace?");
    expect(output).toEqual([
      "Permissions   1 of 3 granted",
      "  ✔ Full Disk Access  iPhone and iPad import",
      "  ○ Automation  no browser used yet",
      "  → macOS dialog opened, turn it on for Clocktrace",
      "  → macOS dialog opened, turn it on for Clocktrace",
      "  ✔ Accessibility     granted",
    ]);
  });

  it("full disk access still denied after the ask offers the reset and asks again", async () => {
    // Given: full disk access denied; the first re-check still reads denied,
    // tccutil succeeds, the re-check after the second ask reads granted
    const p = {
      accessibility: "granted" as const,
      automation: {},
      fullDiskAccess: "denied" as const,
    };
    // When
    const { exit, output, requests, commands } = await run(
      [p, p, { ...p, fullDiskAccess: "granted" }],
      [
        { key: "enter" },
        { key: "enter" },
        "y",
        { key: "enter" },
        { key: "enter" },
      ],
      true,
      {
        commands: {
          "tccutil reset SystemPolicyAllFiles com.clocktrace.app": { code: 0 },
        },
      },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(commands).toEqual([
      "tccutil reset SystemPolicyAllFiles com.clocktrace.app",
    ]);
    expect(requests).toEqual([
      { kind: "fullDiskAccess" },
      { kind: "fullDiskAccess" },
    ]);
    expect(output).toEqual([
      "Permissions   1 of 3 granted",
      "  ✔ Accessibility     window titles",
      "  ○ Automation  no browser used yet",
      "  → System Settings opened, turn it on for Clocktrace",
      "  → System Settings opened, add Clocktrace with + and turn it on",
      "  ✔ Full Disk Access  granted",
    ]);
  });

  it("n at the full disk access reset offer prints its manual command", async () => {
    // Given: full disk access denied and still denied after the ask
    const p = {
      accessibility: "granted" as const,
      automation: {},
      fullDiskAccess: "denied" as const,
    };
    // When
    const { exit, output, requests, commands } = await run(
      [p, p],
      [{ key: "enter" }, { key: "enter" }, "n", { key: "enter" }],
      true,
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(commands).toEqual([]);
    expect(requests).toEqual([{ kind: "fullDiskAccess" }]);
    expect(output[output.length - 1]).toBe(
      "  ○ Full Disk Access  later: tccutil reset SystemPolicyAllFiles com.clocktrace.app, then run clocktrace permissions",
    );
  });

  it("permissions shows a closed browser's Saved grant and asks nothing for it", async () => {
    // Given: Safari closed with a saved granted Grant checked 2026-09-19 18:00Z
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* openStore(path);
          yield* store.setSetting(
            "grant.com.apple.Safari",
            '{"state":"granted","checkedAt":"2026-09-19T18:00:00.000Z"}',
          );
        }),
      ),
    );
    // When
    const { exit, output, shown, requests } = await run(
      [
        {
          accessibility: "granted",
          automation: {
            "com.apple.Safari": "notRunning",
            "com.brave.Browser": "granted",
          },
          fullDiskAccess: "granted",
        },
      ],
      [],
      true,
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(requests).toEqual([]);
    expect(shown).toBe("");
    expect(output).toEqual([
      "Permissions   4 of 4 granted",
      "  ✔ Accessibility        window titles",
      "  ✔ Automation · Safari  URLs in Safari · last checked 2026-09-19 11:00",
      "  ✔ Automation · Brave   URLs in Brave",
      "  ✔ Full Disk Access     iPhone and iPad import",
    ]);
  });

  it("a never-asked browser is not listed and not asked", async () => {
    // Given: Chromium never asked and never in front; interactive, no keys
    // When
    const { exit, output, shown, requests, commands } = await run(
      [
        {
          accessibility: "granted",
          automation: { "org.chromium.Chromium": "notAsked" },
          fullDiskAccess: "granted",
        },
      ],
      [],
      true,
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(shown).not.toContain("Chromium");
    expect(requests).toEqual([]);
    expect(commands).toEqual([]);
    expect(output).toContain("  ○ Automation  no browser used yet");
  });

  it("no denied browser asks no browser question", async () => {
    // Given: Chrome granted, everything granted; interactive
    // When
    const { exit, shown, commands } = await run(
      [
        {
          accessibility: "granted",
          automation: { "com.google.Chrome": "granted" },
          fullDiskAccess: "granted",
        },
      ],
      [],
      true,
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(shown).not.toContain("is denied");
    expect(commands).toEqual([]);
  });

  it("a denied browser opens System Settings and turns granted", async () => {
    // Given: Chrome denied before the walk; the re-read after Switched on
    // says granted; opening System Settings succeeds
    const p: Permissions = {
      accessibility: "granted",
      automation: { "com.google.Chrome": "denied" },
      fullDiskAccess: "granted",
    };
    // When
    const { exit, output, shown, requests, commands } = await run(
      [p, { ...p, automation: { "com.google.Chrome": "granted" } }],
      [{ key: "enter" }, { key: "enter" }],
      true,
      {
        commands: {
          "open x-apple.systempreferences:com.apple.preference.security?Privacy_Automation":
            { code: 0 },
        },
      },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(shown).toContain(
      "Chrome is denied. Open System Settings to turn it on?",
    );
    expect(shown).toContain("Switched on?");
    expect(commands).toEqual([
      "open x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
    ]);
    expect(requests).toEqual([]);
    expect(output[output.length - 1]).toBe("  ✔ Automation · Chrome  granted");
  });

  it("a browser closed during the fix flow shows as granted next time", async () => {
    // Given: Chrome denied before the walk, then closed (notRunning) on the
    // re-read after Switched on
    const p: Permissions = {
      accessibility: "granted",
      automation: { "com.google.Chrome": "denied" },
      fullDiskAccess: "granted",
    };
    // When
    const { exit, output, shown } = await run(
      [p, { ...p, automation: { "com.google.Chrome": "notRunning" } }],
      [{ key: "enter" }, { key: "enter" }],
      true,
      {
        commands: {
          "open x-apple.systempreferences:com.apple.preference.security?Privacy_Automation":
            { code: 0 },
        },
      },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(shown).toContain("Switched on?");
    expect(output).toContain(
      "  Chrome shows as granted the next time you open it",
    );
    expect(output[output.length - 1]).toBe(
      "  Chrome shows as granted the next time you open it",
    );
  });

  it("n at a denied browser opens nothing", async () => {
    // Given: Chrome denied, answered n at the offer
    // When
    const { exit, output, commands } = await run(
      [
        {
          accessibility: "granted",
          automation: { "com.google.Chrome": "denied" },
          fullDiskAccess: "granted",
        },
      ],
      ["n"],
      true,
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(commands).toEqual([]);
    expect(output[output.length - 1]).toBe(
      "  ✘ Automation · Chrome  denied · turn it on in System Settings › Privacy › Automation",
    );
  });

  it("each denied browser gets its own question", async () => {
    // Given: Safari and Chrome both denied; n at each offer
    // When
    const { exit, shown } = await run(
      [
        {
          accessibility: "granted",
          automation: {
            "com.apple.Safari": "denied",
            "com.google.Chrome": "denied",
          },
          fullDiskAccess: "granted",
        },
      ],
      ["n", "n"],
      true,
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    const safari = shown.indexOf(
      "Safari is denied. Open System Settings to turn it on?",
    );
    const chrome = shown.indexOf(
      "Chrome is denied. Open System Settings to turn it on?",
    );
    expect(safari).toBeGreaterThanOrEqual(0);
    expect(chrome).toBeGreaterThan(safari);
  });

  it("a closed denied browser shows as granted next time", async () => {
    // Given: Safari closed with a saved denied Grant checked 2026-09-23 20:20Z
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* openStore(path);
          yield* store.setSetting(
            "grant.com.apple.Safari",
            '{"state":"denied","checkedAt":"2026-09-23T20:20:00.000Z"}',
          );
        }),
      ),
    );
    // When
    const { exit, output, shown, permCalls } = await run(
      [
        {
          accessibility: "granted",
          automation: { "com.apple.Safari": "notRunning" },
          fullDiskAccess: "granted",
        },
      ],
      [{ key: "enter" }, { key: "enter" }],
      true,
      {
        commands: {
          "open x-apple.systempreferences:com.apple.preference.security?Privacy_Automation":
            { code: 0 },
        },
      },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(shown).toContain("Switched on?");
    expect(output).toContain(
      "  Safari shows as granted the next time you open it",
    );
    expect(permCalls).toBe(1);
  });

  it("System Settings that fails to open prints the path", async () => {
    // Given: Chrome denied; the open command exits 1; n at Switched on
    // When
    const { exit, output, shown } = await run(
      [
        {
          accessibility: "granted",
          automation: { "com.google.Chrome": "denied" },
          fullDiskAccess: "granted",
        },
      ],
      [{ key: "enter" }, "n"],
      true,
      {
        commands: {
          "open x-apple.systempreferences:com.apple.preference.security?Privacy_Automation":
            { code: 1 },
        },
      },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toContain(
      "  open System Settings › Privacy & Security › Automation › Clocktrace by hand",
    );
    expect(shown).toContain("Switched on?");
  });

  it("still denied after Switched on offers the reset naming every browser", async () => {
    // Given: Safari granted, Chrome denied; the re-read still says denied;
    // open and tccutil both succeed
    const p: Permissions = {
      accessibility: "granted",
      automation: {
        "com.apple.Safari": "granted",
        "com.google.Chrome": "denied",
      },
      fullDiskAccess: "granted",
    };
    // When
    const { exit, output, shown, commands } = await run(
      [p],
      [{ key: "enter" }, { key: "enter" }, "y", { key: "enter" }],
      true,
      {
        commands: {
          "open x-apple.systempreferences:com.apple.preference.security?Privacy_Automation":
            { code: 0 },
          "tccutil reset AppleEvents com.clocktrace.app": { code: 0 },
        },
      },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(shown).toContain(
      "Still denied. Reset the Automation Grants of Safari and Chrome? macOS asks each again the next time it comes to the front",
    );
    expect(commands).toContain("tccutil reset AppleEvents com.clocktrace.app");
    expect(output).toContain(
      "  ○ Automation · Chrome  reset · macOS asks the next time Chrome comes to the front",
    );
  });

  it("a browser reset shows every browser as reset, granted ones too", async () => {
    // Given: Safari granted, Chrome denied; the re-read still says denied;
    // y at the reset offer; open and tccutil both succeed
    const p: Permissions = {
      accessibility: "granted",
      automation: {
        "com.apple.Safari": "granted",
        "com.google.Chrome": "denied",
      },
      fullDiskAccess: "granted",
    };
    // When
    const { exit, output } = await run(
      [p],
      [{ key: "enter" }, { key: "enter" }, "y", { key: "enter" }],
      true,
      {
        commands: {
          "open x-apple.systempreferences:com.apple.preference.security?Privacy_Automation":
            { code: 0 },
          "tccutil reset AppleEvents com.clocktrace.app": { code: 0 },
        },
      },
    );
    // Then: the reset cleared Safari's Grant too, so its row says reset
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toContain(
      "  ○ Automation · Safari  reset · macOS asks the next time Safari comes to the front",
    );
  });

  it("a browser reset clears the other denied browsers without asking them", async () => {
    // Given: Safari and Chrome both denied; Safari's re-read still says
    // denied; y at the reset offer
    const p: Permissions = {
      accessibility: "granted",
      automation: {
        "com.apple.Safari": "denied",
        "com.google.Chrome": "denied",
      },
      fullDiskAccess: "granted",
    };
    // When
    const { exit, output, shown } = await run(
      [p],
      [{ key: "enter" }, { key: "enter" }, "y", { key: "enter" }],
      true,
      {
        commands: {
          "open x-apple.systempreferences:com.apple.preference.security?Privacy_Automation":
            { code: 0 },
          "tccutil reset AppleEvents com.clocktrace.app": { code: 0 },
        },
      },
    );
    // Then: the reset cleared Chrome too, so it is never asked and gets the
    // same reset row
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(shown).toContain("Safari is denied. Open System Settings");
    expect(shown).not.toContain("Chrome is denied. Open System Settings");
    expect(output).toContain(
      "  ○ Automation · Safari  reset · macOS asks the next time Safari comes to the front",
    );
    expect(output).toContain(
      "  ○ Automation · Chrome  reset · macOS asks the next time Chrome comes to the front",
    );
  });

  it("n at the reset offer prints the manual reset command", async () => {
    // Given: Safari granted, Chrome denied; the re-read still says denied;
    // n at the reset offer
    const p: Permissions = {
      accessibility: "granted",
      automation: {
        "com.apple.Safari": "granted",
        "com.google.Chrome": "denied",
      },
      fullDiskAccess: "granted",
    };
    // When
    const { exit, output, commands } = await run(
      [p],
      [{ key: "enter" }, { key: "enter" }, "n"],
      true,
      {
        commands: {
          "open x-apple.systempreferences:com.apple.preference.security?Privacy_Automation":
            { code: 0 },
        },
      },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(commands.filter((c) => c.startsWith("tccutil"))).toEqual([]);
    expect(output).toContain(
      "  ○ Automation · Chrome  later: tccutil reset AppleEvents com.clocktrace.app, then run clocktrace permissions",
    );
  });

  it("a tccutil that fails prints its first line", async () => {
    // Given: Chrome denied; the re-read still says denied; y at the reset
    // offer; tccutil exits 1 and says why
    const p: Permissions = {
      accessibility: "granted",
      automation: { "com.google.Chrome": "denied" },
      fullDiskAccess: "granted",
    };
    // When
    const { exit, output } = await run(
      [p],
      [{ key: "enter" }, { key: "enter" }, "y"],
      true,
      {
        commands: {
          "open x-apple.systempreferences:com.apple.preference.security?Privacy_Automation":
            { code: 0 },
          "tccutil reset AppleEvents com.clocktrace.app": {
            code: 1,
            output: "tccutil: Failed to reset AppleEvents\n",
          },
        },
      },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output[output.length - 1]).toBe(
      "  ✘ Automation · Chrome  tccutil: Failed to reset AppleEvents",
    );
  });
});
