import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  App,
  AppMissingError,
  appPath,
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
  Schedule,
  Stream,
} from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Style } from "../src/format.js";
import { permissions } from "../src/permissions.js";
import { Prompt, Stdin, StoppedError } from "../src/prompt.js";
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
      readonly openRetry?: Schedule.Schedule<unknown, unknown>;
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
        const helper = Layer.succeed(
          Helper,
          new Helper({
            check: () => Effect.void,
            lines: () => Stream.empty,
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
            biomeDevices: () => Effect.succeed([]),
            biomeRecords: () => Effect.succeed([]),
          }),
        );
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
          exec.layer,
        );
        const exit = yield* Effect.exit(
          permissions(options.openRetry).pipe(Effect.provide(layers)),
        );
        return {
          exit,
          output: yield* console.getLines({ stripAnsi: true }),
          shown: yield* terminal.shown,
          requests: yield* Ref.get(requests),
          commands: yield* Ref.get(exec.recorded),
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

  it("an askable browser is asked and turns granted", async () => {
    // Given: Chromium notAsked; the re-read after the request says granted
    const p: Permissions = {
      accessibility: "granted",
      automation: { "org.chromium.Chromium": "notAsked" },
      fullDiskAccess: "granted",
    };
    // When
    const { exit, output, shown, requests } = await run(
      [p, { ...p, automation: { "org.chromium.Chromium": "granted" } }],
      [{ key: "enter" }],
      true,
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual([
      "Permissions   2 of 3 granted",
      "  ✔ Accessibility          window titles",
      "  ✔ Full Disk Access       iPhone and iPad import",
      "  ✔ Automation · Chromium  granted",
    ]);
    expect(shown).toContain("Allow Automation · Chromium (URLs in Chromium)");
    expect(shown).toContain("(Y/n)");
    expect(requests).toEqual([
      { kind: "automation", bundleId: "org.chromium.Chromium" },
    ]);
  });

  it("an askable browser that answered Don't Allow turns denied with the fix", async () => {
    // Given: Chromium notAsked; the re-read after the request says denied
    const p: Permissions = {
      accessibility: "granted",
      automation: { "org.chromium.Chromium": "notAsked" },
      fullDiskAccess: "granted",
    };
    // When
    const { exit, output } = await run(
      [p, { ...p, automation: { "org.chromium.Chromium": "denied" } }],
      [{ key: "enter" }],
      true,
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output[output.length - 1]).toBe(
      "  ✘ Automation · Chromium  denied · turn it on in System Settings › Privacy › Automation",
    );
  });

  it("n at an askable item prints the later line and asks macOS nothing", async () => {
    // Given: Chromium notAsked, answered n
    const p: Permissions = {
      accessibility: "granted",
      automation: { "org.chromium.Chromium": "notAsked" },
      fullDiskAccess: "granted",
    };
    // When
    const { exit, output, requests } = await run(
      [p],
      ["n", { key: "enter" }],
      true,
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output[output.length - 1]).toBe(
      "  ○ Automation · Chromium  later: run clocktrace permissions",
    );
    expect(requests).toEqual([]);
  });

  it("a denied browser offers the reset and asks macOS again on y", async () => {
    // Given: Chromium denied before the walk; tccutil succeeds; the re-read
    // after the request says granted
    const p: Permissions = {
      accessibility: "granted",
      automation: { "org.chromium.Chromium": "denied" },
      fullDiskAccess: "granted",
    };
    // When
    const { exit, output, shown, requests, commands } = await run(
      [p, { ...p, automation: { "org.chromium.Chromium": "granted" } }],
      ["y", { key: "enter" }],
      true,
      {
        commands: {
          "tccutil reset AppleEvents com.clocktrace.app": { code: 0 },
        },
      },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(commands).toEqual(["tccutil reset AppleEvents com.clocktrace.app"]);
    expect(requests).toEqual([
      { kind: "automation", bundleId: "org.chromium.Chromium" },
    ]);
    expect(shown).toContain(
      "macOS will not ask again — reset the grant for Clocktrace?",
    );
    expect(shown).not.toContain("Allow");
    expect(output).toEqual([
      "Permissions   2 of 3 granted",
      "  ✔ Accessibility          window titles",
      "  ✔ Full Disk Access       iPhone and iPad import",
      "  ✔ Automation · Chromium  granted",
    ]);
  });

  it("n at the reset offer prints the manual reset command", async () => {
    // Given: Chromium denied before the walk, answered n at the offer
    const p: Permissions = {
      accessibility: "granted",
      automation: { "org.chromium.Chromium": "denied" },
      fullDiskAccess: "granted",
    };
    // When
    const { exit, output, requests, commands } = await run(
      [p],
      ["n", { key: "enter" }],
      true,
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(commands).toEqual([]);
    expect(requests).toEqual([]);
    expect(output).toEqual([
      "Permissions   2 of 3 granted",
      "  ✔ Accessibility          window titles",
      "  ✔ Full Disk Access       iPhone and iPad import",
      "  ○ Automation · Chromium  later: tccutil reset AppleEvents com.clocktrace.app, then run clocktrace permissions",
    ]);
  });

  it("a browser reset re-asks the browsers it cleared", async () => {
    // Given: Brave granted, Chromium denied; the reset clears both, so the
    // re-read after the Chromium ask reads Brave notAsked
    const p: Permissions = {
      accessibility: "granted",
      automation: {
        "com.brave.Browser": "granted",
        "org.chromium.Chromium": "denied",
      },
      fullDiskAccess: "granted",
    };
    // When
    const { exit, output, shown, requests, commands } = await run(
      [
        p,
        {
          ...p,
          automation: {
            "com.brave.Browser": "notAsked",
            "org.chromium.Chromium": "granted",
          },
        },
        {
          ...p,
          automation: {
            "com.brave.Browser": "granted",
            "org.chromium.Chromium": "granted",
          },
        },
      ],
      ["y", { key: "enter" }, { key: "enter" }],
      true,
      {
        commands: {
          "tccutil reset AppleEvents com.clocktrace.app": { code: 0 },
        },
      },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(commands).toEqual(["tccutil reset AppleEvents com.clocktrace.app"]);
    expect(requests).toEqual([
      { kind: "automation", bundleId: "org.chromium.Chromium" },
      { kind: "automation", bundleId: "com.brave.Browser" },
    ]);
    expect(shown).toContain("Allow Automation · Brave (URLs in Brave)");
    expect(output).toEqual([
      "Permissions   3 of 4 granted",
      "  ✔ Accessibility          window titles",
      "  ✔ Automation · Brave     URLs in Brave",
      "  ✔ Full Disk Access       iPhone and iPad import",
      "  ✔ Automation · Chromium  granted",
      "  ✔ Automation · Brave     granted",
    ]);
  });

  it("a failed tccutil prints its error and the walk goes on", async () => {
    // Given: Chromium and full disk access denied; tccutil exits 64 with its
    // real stderr text; full disk access grants on re-read
    const p: Permissions = {
      accessibility: "granted",
      automation: { "org.chromium.Chromium": "denied" },
      fullDiskAccess: "denied",
    };
    // When
    const { exit, output, requests } = await run(
      [p, { ...p, fullDiskAccess: "granted" }],
      ["y", { key: "enter" }, { key: "enter" }, { key: "enter" }],
      true,
      {
        commands: {
          "tccutil reset AppleEvents com.clocktrace.app": {
            code: 64,
            output:
              'tccutil: No such bundle identifier "com.clocktrace.app": The operation couldn’t be completed. (OSStatus error -10814.)',
          },
        },
      },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(requests).toEqual([{ kind: "fullDiskAccess" }]);
    const cross = output.indexOf(
      '  ✘ Automation · Chromium  tccutil: No such bundle identifier "com.clocktrace.app": The operation couldn’t be completed. (OSStatus error -10814.)',
    );
    const granted = output.indexOf("  ✔ Full Disk Access       granted");
    expect(cross).toBeGreaterThanOrEqual(0);
    expect(granted).toBeGreaterThan(cross);
  });

  it("a tccutil failure with no output prints its exit code", async () => {
    // Given: Chromium denied; tccutil not listed, so it exits 1 with no output
    const p: Permissions = {
      accessibility: "granted",
      automation: { "org.chromium.Chromium": "denied" },
      fullDiskAccess: "granted",
    };
    // When
    const { exit, output, requests, commands } = await run(
      [p],
      ["y", { key: "enter" }],
      true,
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(commands).toEqual(["tccutil reset AppleEvents com.clocktrace.app"]);
    expect(requests).toEqual([]);
    expect(output[output.length - 1]).toBe(
      "  ✘ Automation · Chromium  tccutil reset exited 1",
    );
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

  it("an askable browser whose re-read never answered shows the fix", async () => {
    // Given: Chromium notAsked; Enter asks; the re-read returns noAnswer
    const p: Permissions = {
      accessibility: "granted",
      automation: { "org.chromium.Chromium": "notAsked" },
      fullDiskAccess: "granted",
    };
    // When
    const { exit, output, requests } = await run(
      [p, { ...p, automation: { "org.chromium.Chromium": "noAnswer" } }],
      [{ key: "enter" }],
      true,
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual([
      "Permissions   2 of 3 granted",
      "  ✔ Accessibility          window titles",
      "  ✔ Full Disk Access       iPhone and iPad import",
      "  ○ Automation · Chromium  URLs in Chromium  Chromium did not answer · quit Chromium, open it again, then run clocktrace permissions",
    ]);
    expect(requests).toEqual([
      { kind: "automation", bundleId: "org.chromium.Chromium" },
    ]);
  });

  it("a helper failure during a request prints the cross and goes on", async () => {
    // Given: Chromium notAsked and full disk access denied; the Chromium
    // request dies in the helper, full disk access grants on re-read
    const p: Permissions = {
      accessibility: "granted",
      automation: { "org.chromium.Chromium": "notAsked" },
      fullDiskAccess: "denied",
    };
    // When
    const { exit, output } = await run(
      [p, { ...p, fullDiskAccess: "granted" }],
      [{ key: "enter" }, { key: "enter" }, { key: "enter" }],
      true,
      {
        requestError: (grant) =>
          grant.kind === "automation"
            ? new HelperExitedError({ cause: "open exited 1" })
            : null,
      },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    const cross = output.indexOf(
      "  ✘ Automation · Chromium  helper exited: open exited 1",
    );
    const granted = output.indexOf("  ✔ Full Disk Access       granted");
    expect(cross).toBeGreaterThanOrEqual(0);
    expect(granted).toBeGreaterThan(cross);
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
      "Permissions   1 of 4 granted",
      "  ✔ Accessibility          window titles",
      "  ○ Automation · Safari    URLs in Safari    Safari is closed",
      "  ○ Automation · Chromium  URLs in Chromium  not asked",
      "  ✘ Full Disk Access       denied · turn it on in System Settings › Privacy › Full Disk Access",
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

  it("ctrl-c at a permission question stops the walk", async () => {
    // Given: Chromium notAsked; ctrl-c at its question
    const p: Permissions = {
      accessibility: "granted",
      automation: { "org.chromium.Chromium": "notAsked" },
      fullDiskAccess: "granted",
    };
    // When
    const { exit, output, requests } = await run(
      [p],
      [{ key: "c", ctrl: true }],
      true,
    );
    // Then
    expect(exit).toEqual(Exit.fail(new StoppedError()));
    expect(requests).toEqual([]);
    expect(output).toEqual([
      "Permissions   2 of 3 granted",
      "  ✔ Accessibility          window titles",
      "  ✔ Full Disk Access       iPhone and iPad import",
    ]);
  });

  it("permissions with the app missing fails app missing", async () => {
    // Given: installed and running, database present, no app
    const appMissing = Layer.succeed(
      App,
      new App({
        isInstalled: () => Effect.succeed(false),
        install: () => Effect.succeed("written" as const),
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
    expect(exit).toEqual(Exit.fail(new AppMissingError({ path: appPath })));
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

  it("a closed browser opens on y and is asked once running", async () => {
    // Given
    const p = {
      accessibility: "granted" as const,
      automation: { "com.apple.Safari": "notRunning" as const },
      fullDiskAccess: "granted" as const,
    };
    // When
    const { exit, output, commands, requests } = await run(
      [
        p,
        { ...p, automation: { "com.apple.Safari": "notAsked" } },
        { ...p, automation: { "com.apple.Safari": "granted" } },
      ],
      ["y", { key: "enter" }, { key: "enter" }],
      true,
      { commands: { "open -b com.apple.Safari": { code: 0 } } },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(commands).toEqual(["open -b com.apple.Safari"]);
    expect(requests).toEqual([
      { kind: "automation", bundleId: "com.apple.Safari" },
    ]);
    expect(output).toEqual([
      "Permissions   2 of 3 granted",
      "  ✔ Accessibility        window titles",
      "  ✔ Full Disk Access     iPhone and iPad import",
      "  ○ Automation · Safari  URLs in Safari  Safari is closed",
      "  ✔ Automation · Safari  granted",
    ]);
  });

  it("n at the open offer prints the later line and opens nothing", async () => {
    // Given
    const p = {
      accessibility: "granted" as const,
      automation: { "com.apple.Safari": "notRunning" as const },
      fullDiskAccess: "granted" as const,
    };
    // When
    const { exit, output, commands, requests } = await run(
      [p],
      ["n", { key: "enter" }],
      true,
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(commands).toEqual([]);
    expect(requests).toEqual([]);
    expect(output[output.length - 1]).toBe(
      "  later: open the browser, then run clocktrace permissions",
    );
  });

  it("a browser that fails to open shows the warn line", async () => {
    // Given
    const p = {
      accessibility: "granted" as const,
      automation: { "com.apple.Safari": "notRunning" as const },
      fullDiskAccess: "granted" as const,
    };
    // When
    const { exit, output, commands, requests } = await run(
      [p],
      ["y", { key: "enter" }],
      true,
      { commands: { "open -b com.apple.Safari": { code: 1 } } },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(commands).toEqual(["open -b com.apple.Safari"]);
    expect(requests).toEqual([]);
    expect(output[output.length - 1]).toBe(
      "  ○ Automation · Safari  Safari did not open · open it, then run clocktrace permissions",
    );
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
      "Permissions   1 of 2 granted",
      "  ✔ Accessibility     window titles",
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
      "Permissions   1 of 2 granted",
      "  ✔ Full Disk Access  iPhone and iPad import",
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

  it("a browser that stays closed after polling shows the warn line", async () => {
    // Given
    const p = {
      accessibility: "granted" as const,
      automation: { "com.apple.Safari": "notRunning" as const },
      fullDiskAccess: "granted" as const,
    };
    // When
    const { exit, output, requests } = await run(
      [p],
      ["y", { key: "enter" }],
      true,
      {
        commands: { "open -b com.apple.Safari": { code: 0 } },
        openRetry: Schedule.recurs(2),
      },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(requests).toEqual([]);
    expect(output[output.length - 1]).toBe(
      "  ○ Automation · Safari  Safari did not open · open it, then run clocktrace permissions",
    );
  });

  it("a helper failure while waiting for a browser to run prints the cross", async () => {
    // Given
    const p = {
      accessibility: "granted" as const,
      automation: { "com.apple.Safari": "notRunning" as const },
      fullDiskAccess: "granted" as const,
    };
    // When: the browser is asked to open, then the helper errors on the poll
    const { exit, output, requests } = await run(
      [p],
      ["y", { key: "enter" }],
      true,
      {
        commands: { "open -b com.apple.Safari": { code: 0 } },
        permissionsErrorAt: 1,
      },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(requests).toEqual([]);
    expect(output[output.length - 1]).toBe(
      "  ✘ Automation · Safari  helper exited: gone",
    );
  });

  it("a browser that closes before the ask shows closed, not denied", async () => {
    // Given: Safari opens, reads notAsked, then reports notRunning at request
    const closed = {
      accessibility: "granted" as const,
      automation: { "com.apple.Safari": "notRunning" as const },
      fullDiskAccess: "granted" as const,
    };
    const pending = {
      ...closed,
      automation: { "com.apple.Safari": "notAsked" as const },
    };
    // When
    const { exit, output, requests } = await run(
      [closed, pending, pending],
      ["y", { key: "enter" }, { key: "enter" }],
      true,
      {
        commands: { "open -b com.apple.Safari": { code: 0 } },
        outcome: "notRunning",
      },
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(requests).toEqual([
      { kind: "automation", bundleId: "com.apple.Safari" },
    ]);
    expect(output[output.length - 1]).toBe(
      "  ○ Automation · Safari  URLs in Safari  Safari is closed",
    );
  });
});
