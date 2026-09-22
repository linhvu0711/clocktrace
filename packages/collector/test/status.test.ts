import { Store } from "@clocktrace/core";
import { NodeContext } from "@effect/platform-node";
import {
  ConfigProvider,
  DateTime,
  Effect,
  Exit,
  Layer,
  Ref,
  Stream,
  TestClock,
  TestContext,
} from "effect";
import { describe, expect, it } from "vitest";

import { Helper, HelperNotFoundError } from "../src/helper.js";
import { fakeLaunchd, Launchd, type LaunchdState } from "../src/launchd.js";
import type { Permissions } from "../src/permissions.js";
import { readStatus, statusLines } from "../src/status.js";

const dbPath = "/Users/me/Library/Application Support/clocktrace/clocktrace.db";

const stubHelper = (p: Permissions) =>
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

const config = ConfigProvider.fromMap(
  new Map([
    ["CLOCKTRACE_HELPER", "/stub"],
    ["CLOCKTRACE_DB", dbPath],
  ]),
);

const runWith = (
  p: Permissions,
  launchdState: LaunchdState,
  inside: Effect.Effect<
    ReadonlyArray<string>,
    unknown,
    Store | Helper | Launchd | DateTime.CurrentTimeZone
  >,
) =>
  Effect.runPromise(
    Effect.flatMap(Ref.make(launchdState), (state) =>
      inside.pipe(
        Effect.provide(
          Layer.mergeAll(stubHelper(p), fakeLaunchd(state), Store.Test),
        ),
        Effect.withConfigProvider(config),
        DateTime.withCurrentZoneNamed("America/Los_Angeles"),
      ),
    ),
  );

const NOW = Date.UTC(2026, 8, 19, 17, 30);

const runAt = <A>(
  p: Permissions,
  launchdState: LaunchdState,
  inside: Effect.Effect<
    A,
    unknown,
    Store | Helper | Launchd | DateTime.CurrentTimeZone
  >,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const state = yield* Ref.make(launchdState);
      return yield* inside.pipe(
        Effect.provide(
          Layer.mergeAll(stubHelper(p), fakeLaunchd(state), Store.Test),
        ),
        Effect.withConfigProvider(config),
        DateTime.withCurrentZoneNamed("America/Los_Angeles"),
      );
    }).pipe(Effect.provide(TestContext.TestContext)),
  );

const seed = (store: Store) =>
  Effect.gen(function* () {
    const iphone = yield* store.getOrInsertDevice({
      kind: "iphone",
      name: "iPhone",
      externalId: "P2",
    });
    yield* store.getOrInsertDevice({
      kind: "ipad",
      name: "Linh's iPad",
      externalId: "P3",
    });
    yield* store.insertActivity({
      deviceId: iphone.id,
      bundleId: "com.apple.mobilesafari",
      appName: "com.apple.mobilesafari",
      title: null,
      url: null,
      startedAt: DateTime.unsafeMake("2026-09-19T16:01:00Z"),
      endedAt: DateTime.unsafeMake("2026-09-19T16:06:00Z"),
    });
  });

const BLOB_OK = JSON.stringify({
  state: "ok",
  at: "2026-09-19T17:30:00.000Z",
  devices: [
    { externalId: "P2", lastSync: "2026-09-19T17:00:00.000Z" },
    { externalId: "P3", lastSync: "2026-09-17T17:00:00.000Z" },
  ],
});

const BLOB_NOT_TESTED = JSON.stringify({
  state: "notTested",
  at: "2026-09-19T17:30:00.000Z",
  macosVersion: "26.6.2",
});

const BLOB_BROKEN = JSON.stringify({
  state: "broken",
  at: "2026-09-19T17:30:00.000Z",
  reason: "no App.InFocus remote folder",
  devices: [{ externalId: "P2", lastSync: "2026-09-19T17:00:00.000Z" }],
});

const allGranted: Permissions = {
  accessibility: "granted",
  automation: {},
  fullDiskAccess: "granted",
};

const running = {
  installed: true,
  running: true,
  plist: null,
  installs: 0,
};

describe("status", () => {
  it("a stopped Collector with denied grants and no Activities", async () => {
    // Given: a stopped agent, denied grants, an empty store
    // When
    const lines = await runWith(
      {
        accessibility: "denied",
        automation: {
          "com.apple.Safari": "notRunning",
          "com.google.Chrome": "notAsked",
          "com.brave.Browser": "notInstalled",
        },
        fullDiskAccess: "denied",
      },
      { installed: true, running: false, plist: null, installs: 0 },
      Effect.flatMap(readStatus(), statusLines),
    );
    // Then
    expect(lines).toEqual([
      "collector: stopped, run clocktrace start",
      "accessibility: denied, window titles are not tracked",
      "automation Safari: not checked, Safari is closed",
      "automation Chrome: denied, URLs in Chrome are not tracked",
      "full disk access: denied, iPhone and iPad time is not imported",
      "last activity: none yet",
      `database: ${dbPath}`,
    ]);
  });

  it("a running Collector with every grant and one Activity", async () => {
    // Given: a running agent, every grant, one Activity on one device
    // When
    const lines = await runWith(
      {
        accessibility: "granted",
        automation: { "com.apple.Safari": "granted" },
        fullDiskAccess: "granted",
      },
      { installed: true, running: true, plist: null, installs: 0 },
      Effect.gen(function* () {
        const store = yield* Store;
        const device = yield* store.getOrInsertDevice({
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
          startedAt: DateTime.unsafeMake("2026-09-18T17:00:00Z"),
          endedAt: DateTime.unsafeMake("2026-09-18T17:05:00Z"),
        });
        const status = yield* readStatus();
        return yield* statusLines(status);
      }),
    );
    // Then
    expect(lines).toEqual([
      "collector: running",
      "accessibility: granted",
      "automation Safari: granted",
      "full disk access: granted",
      "last activity: 2026-09-18 10:05",
      `database: ${dbPath}`,
    ]);
  });

  it("readStatus fails with HelperNotFoundError when the binary is missing", async () => {
    // Given: CLOCKTRACE_HELPER points at a path that does not exist
    const layers = Layer.mergeAll(
      Helper.Default,
      Launchd.Test,
      Store.Test,
      NodeContext.layer,
    );
    // When
    const exit = await Effect.runPromise(
      Effect.exit(readStatus()).pipe(
        Effect.provide(layers),
        Effect.withConfigProvider(
          ConfigProvider.fromMap(
            new Map([
              ["CLOCKTRACE_HELPER", "/nope/clocktrace-helper"],
              ["CLOCKTRACE_DB", dbPath],
            ]),
          ),
        ),
      ),
    );
    // Then
    expect(exit).toEqual(
      Exit.fail(new HelperNotFoundError({ path: "/nope/clocktrace-helper" })),
    );
  });

  it("iOS import ok with a syncing iPhone and a stale iPad", async () => {
    // Given: every grant, an ok import blob, an iPhone and an iPad
    // When
    const lines = await runAt(
      allGranted,
      running,
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seed(store);
        yield* store.setSetting("importer.status", BLOB_OK);
        const status = yield* readStatus();
        return yield* statusLines(status);
      }),
    );
    // Then
    expect(lines).toEqual([
      "collector: running",
      "accessibility: granted",
      "full disk access: granted",
      "iOS import: ok 2026-09-19 10:30",
      "Linh's iPad: not syncing since 2026-09-17 10:00",
      "Linh's iPad: last activity none yet",
      "iPhone: last synced 2026-09-19 10:00",
      "iPhone: last activity 2026-09-19 09:06",
      "last activity: 2026-09-19 09:06",
      `database: ${dbPath}`,
    ]);
  });

  it("iOS import not tested on another macOS", async () => {
    // Given: every grant, a not-tested import blob, no devices
    // When
    const lines = await runAt(
      allGranted,
      running,
      Effect.gen(function* () {
        const store = yield* Store;
        yield* store.setSetting("importer.status", BLOB_NOT_TESTED);
        const status = yield* readStatus();
        return yield* statusLines(status);
      }),
    );
    // Then
    expect(lines).toEqual([
      "collector: running",
      "accessibility: granted",
      "full disk access: granted",
      "iOS import: not tested on macOS 26.6.2",
      "last activity: none yet",
      `database: ${dbPath}`,
    ]);
  });

  it("iOS import broken with the reason", async () => {
    // Given: every grant, a broken import blob, no devices
    // When
    const lines = await runAt(
      allGranted,
      running,
      Effect.gen(function* () {
        const store = yield* Store;
        yield* store.setSetting("importer.status", BLOB_BROKEN);
        const status = yield* readStatus();
        return yield* statusLines(status);
      }),
    );
    // Then
    expect(lines).toEqual([
      "collector: running",
      "accessibility: granted",
      "full disk access: granted",
      "iOS import: broken: no App.InFocus remote folder",
      "last activity: none yet",
      `database: ${dbPath}`,
    ]);
  });

  it("a denied Full Disk Access hides the iOS lines", async () => {
    // Given: a denied Full Disk Access, an ok import blob, both devices
    // When
    const { lines, status } = await runAt(
      { ...allGranted, fullDiskAccess: "denied" },
      running,
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seed(store);
        yield* store.setSetting("importer.status", BLOB_OK);
        const status = yield* readStatus();
        return { lines: yield* statusLines(status), status };
      }),
    );
    // Then
    expect(lines).toEqual([
      "collector: running",
      "accessibility: granted",
      "full disk access: denied, iPhone and iPad time is not imported",
      "last activity: 2026-09-19 09:06",
      `database: ${dbPath}`,
    ]);
    expect(status.iosImport).toBeNull();
    expect(status.devices).toEqual([]);
  });
});
