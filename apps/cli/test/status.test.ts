import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  App,
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
  Console,
  DateTime,
  Effect,
  Exit,
  Layer,
  Ref,
  Stream,
} from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Style } from "../src/format.js";
import { Prompt } from "../src/prompt.js";
import { NotSetUpError } from "../src/set-up.js";
import { status } from "../src/status.js";
import * as MockConsole from "./mock-console.js";
import * as MockTerminal from "./mock-terminal.js";

const helperStub = (p: Permissions) =>
  Layer.succeed(
    Helper,
    new Helper({
      check: () => Effect.void,
      lines: () => Stream.empty,
      permissions: () => Effect.succeed(p),
      request: () => Effect.succeed("asked"),
      biomeDevices: () => Effect.succeed([]),
      biomeRecords: () => Effect.succeed([]),
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
      biomeDevices: () => Effect.succeed([]),
      biomeRecords: () => Effect.succeed([]),
    }),
  );

const allGranted: Permissions = {
  accessibility: "granted",
  automation: {},
  fullDiskAccess: "granted",
};

const seedOne = (dbPath: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const store = yield* openStore(dbPath);
      const device = yield* store.upsertDevice({
        kind: "mac",
        name: "Studio",
        externalId: "mac-1",
      });
      yield* store.insertActivity({
        deviceId: device.id,
        bundleId: "com.apple.finder",
        appName: "Finder",
        title: null,
        url: null,
        startedAt: DateTime.unsafeMake("2026-09-18T17:00:00.000Z"),
        endedAt: DateTime.unsafeMake("2026-09-18T17:05:00.000Z"),
      });
    }),
  );

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
      | App
      | import("@effect/platform").FileSystem.FileSystem
      | DateTime.CurrentTimeZone
      | Style
    >,
    appLayer: Layer.Layer<App> = App.Test,
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = yield* MockTerminal.make(true);
        const console = yield* MockConsole.make;
        const state = yield* Ref.make(launchdState);
        const layers = Layer.mergeAll(
          Console.setConsole(console),
          NodeContext.layer,
          terminal.layer,
          Prompt.Default,
          fakeLaunchd(state),
          helperStub(p),
          appLayer,
          Style.Test,
        );
        const exit = yield* Effect.exit(command.pipe(Effect.provide(layers)));
        const output = yield* console.getLines({ stripAnsi: true });
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
    expect(exit).toEqual(Exit.fail(new NotSetUpError({ dbPath: path })));
    if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
      expect((exit.cause.error as NotSetUpError).message).toBe(
        `not set up, run clocktrace setup · looked for ${path}`,
      );
    }
    expect(existsSync(path)).toBe(false);
  });

  it("status says app missing and every permission not checked", async () => {
    // Given: the plist installed, the collector running, the database file, no app
    await Effect.runPromise(Effect.scoped(openStore(path)));
    const appMissing = Layer.succeed(
      App,
      new App({
        isInstalled: () => Effect.succeed(false),
        install: () => Effect.succeed("written" as const),
      }),
    );
    // When
    const { exit, output } = await run(
      allGranted,
      { installed: true, running: true, plist: null, installs: 0 },
      status(),
      appMissing,
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual([
      "collector: running",
      "app: missing, run clocktrace setup",
      "accessibility: not checked",
      "full disk access: not checked",
      "last activity: none yet",
      `database: ${path}`,
    ]);
  });

  it("status names a Helper failure", async () => {
    // Given: set up (installed, running, database) and the Helper exits with an error
    await Effect.runPromise(Effect.scoped(openStore(path)));
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const terminal = yield* MockTerminal.make(true);
        const console = yield* MockConsole.make;
        const state = yield* Ref.make<LaunchdState>({
          installed: true,
          running: true,
          plist: null,
          installs: 0,
        });
        const layers = Layer.mergeAll(
          Console.setConsole(console),
          NodeContext.layer,
          terminal.layer,
          Prompt.Default,
          fakeLaunchd(state),
          helperExits("boom"),
          App.Test,
          Style.Test,
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

  it("status prints the groups with marks, the count, and the database path", async () => {
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
      "Collector      ✔ running",
      "Permissions    2 of 2 granted",
      "  ✔ Accessibility     window titles",
      "  ✔ Full Disk Access  iPhone and iPad import",
      "Last activity  none yet",
      `Database       ${path}`,
    ]);
  });

  it("status prints a closed browser, a denied one, and the last activity", async () => {
    // Given: Safari not running, Chrome denied, one Activity
    await Effect.runPromise(Effect.scoped(openStore(path)));
    await Effect.runPromise(seedOne(path));
    // When
    const { exit, output } = await run(
      {
        accessibility: "granted",
        automation: {
          "com.apple.Safari": "notRunning",
          "com.google.Chrome": "denied",
        },
        fullDiskAccess: "granted",
      },
      { installed: true, running: true, plist: null, installs: 0 },
      status(),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual([
      "Collector      ✔ running",
      "Permissions    2 of 4 granted",
      "  ✔ Accessibility        window titles",
      "  ✔ Full Disk Access     iPhone and iPad import",
      "  ○ Automation · Safari  Safari is closed",
      "  ✘ Automation · Chrome  denied · turn it on in System Settings › Privacy › Automation",
      "Last activity  2026-09-18 10:05",
      `Database       ${path}`,
    ]);
  });

  it("status paints the marks when color is on", async () => {
    // Given: the same as the first case, but color on
    await Effect.runPromise(Effect.scoped(openStore(path)));
    const { exit, output } = await Effect.runPromise(
      Effect.gen(function* () {
        const terminal = yield* MockTerminal.make(true);
        const console = yield* MockConsole.make;
        const state = yield* Ref.make<LaunchdState>({
          installed: true,
          running: true,
          plist: null,
          installs: 0,
        });
        const layers = Layer.mergeAll(
          Console.setConsole(console),
          NodeContext.layer,
          terminal.layer,
          Prompt.Default,
          fakeLaunchd(state),
          helperStub(allGranted),
          App.Test,
          Layer.succeed(
            Style,
            new Style({ color: true, unicode: true, width: 0 }),
          ),
        );
        const exit = yield* Effect.exit(status().pipe(Effect.provide(layers)));
        const output = yield* console.getLines();
        return { exit, output };
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
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual([
      "\u001b[0;1mCollector\u001b[0m      \u001b[0;32m✔\u001b[0m running",
      "\u001b[0;1mPermissions\u001b[0m    \u001b[0;90m2 of 2 granted\u001b[0m",
      "  \u001b[0;32m✔\u001b[0m Accessibility     \u001b[0;90mwindow titles\u001b[0m",
      "  \u001b[0;32m✔\u001b[0m Full Disk Access  \u001b[0;90miPhone and iPad import\u001b[0m",
      "\u001b[0;1mLast activity\u001b[0m  none yet",
      `\u001b[0;1mDatabase\u001b[0m       \u001b[0;90m${path}\u001b[0m`,
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
      app: "present",
      permissions: [
        { name: "accessibility", state: "granted", note: null },
        { name: "full disk access", state: "granted", note: null },
      ],
      lastActivity: null,
      iosImport: null,
      devices: [],
      databasePath: path,
    });
  });

  it("status prints the iOS import group and the device rows", async () => {
    // Given: an ok import blob, a stale iPad, an iPhone with one Activity
    await Effect.runPromise(Effect.scoped(openStore(path)));
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* openStore(path);
          yield* store.upsertDevice({
            kind: "ipad",
            name: "Linh's iPad",
            externalId: "P3",
          });
          const iphone = yield* store.upsertDevice({
            kind: "iphone",
            name: "iPhone",
            externalId: "P2",
          });
          yield* store.insertActivity({
            deviceId: iphone.id,
            bundleId: "com.apple.mobilesafari",
            appName: "com.apple.mobilesafari",
            title: null,
            url: null,
            startedAt: DateTime.unsafeMake("2026-09-19T16:01:00.000Z"),
            endedAt: DateTime.unsafeMake("2026-09-19T16:06:00.000Z"),
          });
          yield* store.setSetting(
            "importer.status",
            JSON.stringify({
              state: "ok",
              at: "2026-09-19T17:30:00.000Z",
              devices: [
                { externalId: "P3", lastSync: "2026-09-17T17:00:00.000Z" },
              ],
            }),
          );
        }),
      ),
    );
    // When
    const { exit, output } = await run(
      allGranted,
      { installed: true, running: true, plist: null, installs: 0 },
      status(),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual([
      "Collector      ✔ running",
      "Permissions    2 of 2 granted",
      "  ✔ Accessibility     window titles",
      "  ✔ Full Disk Access  iPhone and iPad import",
      "iOS import     ✔ ok · 2026-09-19 10:30",
      "  ✘ Linh's iPad  not syncing since 2026-09-17 10:00 · last activity none yet",
      "  ○ iPhone       never synced · last activity 2026-09-19 09:06",
      "Last activity  2026-09-19 09:06",
      `Database       ${path}`,
    ]);
  });

  it("status prints a renamed iPhone", async () => {
    // Given: the same seed, with the iPhone upserted again under its new name
    await Effect.runPromise(Effect.scoped(openStore(path)));
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* openStore(path);
          yield* store.upsertDevice({
            kind: "ipad",
            name: "Linh's iPad",
            externalId: "P3",
          });
          const iphone = yield* store.upsertDevice({
            kind: "iphone",
            name: "iPhone",
            externalId: "P2",
          });
          yield* store.upsertDevice({
            kind: "iphone",
            name: "Linh's iPhone",
            externalId: "P2",
          });
          yield* store.insertActivity({
            deviceId: iphone.id,
            bundleId: "com.apple.mobilesafari",
            appName: "com.apple.mobilesafari",
            title: null,
            url: null,
            startedAt: DateTime.unsafeMake("2026-09-19T16:01:00.000Z"),
            endedAt: DateTime.unsafeMake("2026-09-19T16:06:00.000Z"),
          });
          yield* store.setSetting(
            "importer.status",
            JSON.stringify({
              state: "ok",
              at: "2026-09-19T17:30:00.000Z",
              devices: [
                { externalId: "P3", lastSync: "2026-09-17T17:00:00.000Z" },
              ],
            }),
          );
        }),
      ),
    );
    // When
    const { exit, output } = await run(
      allGranted,
      { installed: true, running: true, plist: null, installs: 0 },
      status(),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual([
      "Collector      ✔ running",
      "Permissions    2 of 2 granted",
      "  ✔ Accessibility     window titles",
      "  ✔ Full Disk Access  iPhone and iPad import",
      "iOS import     ✔ ok · 2026-09-19 10:30",
      "  ✘ Linh's iPad    not syncing since 2026-09-17 10:00 · last activity none yet",
      "  ○ Linh's iPhone  never synced · last activity 2026-09-19 09:06",
      "Last activity  2026-09-19 09:06",
      `Database       ${path}`,
    ]);
  });
});
