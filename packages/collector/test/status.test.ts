import { Store } from "@clocktrace/core";
import {
  ConfigProvider,
  DateTime,
  Effect,
  Layer,
  Option,
  Ref,
  Stream,
  TestClock,
  TestContext,
} from "effect";
import { describe, expect, it } from "vitest";

import { App } from "../src/app.js";
import { Helper } from "../src/helper.js";
import {
  fakeLaunchd,
  type Launchd,
  type LaunchdState,
} from "../src/launchd.js";
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

const runWith = <A>(
  p: Permissions,
  launchdState: LaunchdState,
  inside: Effect.Effect<
    A,
    unknown,
    Store | Helper | Launchd | App | DateTime.CurrentTimeZone
  >,
  appLayer: Layer.Layer<App> = App.Test,
) =>
  Effect.runPromise(
    Effect.flatMap(Ref.make(launchdState), (state) =>
      inside.pipe(
        Effect.provide(
          Layer.mergeAll(
            stubHelper(p),
            fakeLaunchd(state),
            Store.Test,
            appLayer,
          ),
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
    Store | Helper | Launchd | App | DateTime.CurrentTimeZone
  >,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const state = yield* Ref.make(launchdState);
      return yield* inside.pipe(
        Effect.provide(
          Layer.mergeAll(
            stubHelper(p),
            fakeLaunchd(state),
            Store.Test,
            App.Test,
          ),
        ),
        Effect.withConfigProvider(config),
        DateTime.withCurrentZoneNamed("America/Los_Angeles"),
      );
    }).pipe(Effect.provide(TestContext.TestContext)),
  );

const seed = (store: Store) =>
  Effect.gen(function* () {
    const iphone = yield* store.upsertDevice({
      kind: "iphone",
      name: "iPhone",
      externalId: "P2",
    });
    yield* store.upsertDevice({
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
      "automation: not checked, no browser used yet",
      "full disk access: denied, iPhone and iPad time is not imported",
      "last activity: none yet",
      `database: ${dbPath}`,
    ]);
  });

  it("a browser that did not answer is not checked with the fix", async () => {
    // Given: a stopped agent, Chrome noAnswer, an empty store
    // When
    const lines = await runWith(
      {
        accessibility: "denied",
        automation: {
          "com.apple.Safari": "notRunning",
          "com.google.Chrome": "noAnswer",
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
      "automation Chrome: not checked, Chrome did not answer · quit Chrome, open it again, then run clocktrace permissions",
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

  it("a missing app prints app missing and every permission not checked", async () => {
    // Given: App.isInstalled is false, a running agent, the all-granted Helper stub
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
    const lines = await runWith(
      {
        accessibility: "granted",
        automation: {},
        fullDiskAccess: "granted",
      },
      { installed: true, running: true, plist: null, installs: 0 },
      Effect.flatMap(readStatus(), statusLines),
      appMissing,
    );
    // Then
    expect(lines).toEqual([
      "collector: running",
      "app: missing, run clocktrace setup",
      "accessibility: not checked",
      "full disk access: not checked",
      "last activity: none yet",
      `database: ${dbPath}`,
    ]);
  });

  it("readStatus reports app present when the bundle exists", async () => {
    // Given: App.Test, a running agent, every grant
    // When
    const status = await runWith(
      {
        accessibility: "granted",
        automation: {},
        fullDiskAccess: "granted",
      },
      { installed: true, running: true, plist: null, installs: 0 },
      readStatus(),
    );
    // Then
    expect(status.app).toBe("present");
    expect(status.permissions).toEqual([
      {
        name: "accessibility",
        state: "granted",
        note: null,
        checkedAt: null,
      },
      {
        name: "automation",
        state: "not checked",
        note: "no browser used yet",
        checkedAt: null,
      },
      {
        name: "full disk access",
        state: "granted",
        note: null,
        checkedAt: null,
      },
    ]);
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
      "automation: not checked, no browser used yet",
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
    // Given: every grant, a not-tested import blob, devices from a prior version
    // When
    const { lines, status } = await runAt(
      allGranted,
      running,
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seed(store);
        yield* store.setSetting("importer.status", BLOB_NOT_TESTED);
        const status = yield* readStatus();
        return { lines: yield* statusLines(status), status };
      }),
    );
    // Then: no device rows — a not-tested run has no sync observations
    expect(status.devices).toEqual([]);
    expect(lines).toEqual([
      "collector: running",
      "accessibility: granted",
      "automation: not checked, no browser used yet",
      "full disk access: granted",
      "iOS import: not tested on macOS 26.6.2",
      "last activity: 2026-09-19 09:06",
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
      "automation: not checked, no browser used yet",
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
      "automation: not checked, no browser used yet",
      "full disk access: denied, iPhone and iPad time is not imported",
      "last activity: 2026-09-19 09:06",
      `database: ${dbPath}`,
    ]);
    expect(status.iosImport).toBeNull();
    expect(status.devices).toEqual([]);
  });

  it("a closed browser shows its Saved grant and when it was checked", async () => {
    // Given: Safari closed, Chrome granted; a saved denied Grant for Safari
    // When
    const lines = await runWith(
      {
        accessibility: "granted",
        automation: {
          "com.apple.Safari": "notRunning",
          "com.google.Chrome": "granted",
        },
        fullDiskAccess: "granted",
      },
      { installed: true, running: false, plist: null, installs: 0 },
      Effect.gen(function* () {
        const store = yield* Store;
        yield* store.setSetting(
          "grant.com.apple.Safari",
          '{"state":"denied","checkedAt":"2026-09-19T18:00:00.000Z"}',
        );
        return yield* Effect.flatMap(readStatus(), statusLines);
      }),
    );
    // Then
    expect(lines).toEqual([
      "collector: stopped, run clocktrace start",
      "accessibility: granted",
      "automation Safari: denied, URLs in Safari are not tracked, last checked 2026-09-19 11:00",
      "automation Chrome: granted",
      "full disk access: granted",
      "last activity: none yet",
      `database: ${dbPath}`,
    ]);
  });

  it("a read with no browsers in front says so", async () => {
    // Given: no automation states at all
    // When
    const lines = await runWith(
      {
        accessibility: "granted",
        automation: {},
        fullDiskAccess: "granted",
      },
      { installed: true, running: false, plist: null, installs: 0 },
      Effect.flatMap(readStatus(), statusLines),
    );
    // Then
    expect(lines).toEqual([
      "collector: stopped, run clocktrace start",
      "accessibility: granted",
      "automation: not checked, no browser used yet",
      "full disk access: granted",
      "last activity: none yet",
      `database: ${dbPath}`,
    ]);
  });

  it("a live check updates the Saved grant", async () => {
    // Given: Chrome answered granted at NOW
    // When
    const saved = await runAt(
      {
        accessibility: "granted",
        automation: { "com.google.Chrome": "granted" },
        fullDiskAccess: "granted",
      },
      { installed: true, running: true, plist: null, installs: 0 },
      Effect.gen(function* () {
        yield* readStatus();
        const store = yield* Store;
        return yield* store.getSetting("grant.com.google.Chrome");
      }),
    );
    // Then
    expect(saved).toEqual(
      Option.some('{"state":"granted","checkedAt":"2026-09-19T17:30:00.000Z"}'),
    );
  });
});
