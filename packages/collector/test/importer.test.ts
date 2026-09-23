import { readFileSync } from "node:fs";

import { type ImportBatch, Store, StoreError } from "@clocktrace/core";
import {
  DateTime,
  Effect,
  Either,
  Layer,
  Option,
  Ref,
  Schema,
  TestClock,
  TestContext,
} from "effect";
import { describe, expect, it } from "vitest";

import { BiomeExitError, Helper } from "../src/helper.js";
import {
  ImportResult,
  importOnce,
  importProgressKey,
  importStatusKey,
  importTick,
} from "../src/importer.js";
import { MacIdentity } from "../src/mac-identity.js";

const P2 = "00000000-0000-4000-8000-000000000002";
const P3 = "00000000-0000-4000-8000-000000000003";
const S = "000000000000001";
const T = "000000000000007";

const NOW = Date.UTC(2026, 8, 19, 17, 30);

const D_MAC =
  '{"deviceIdentifier":"00000000-0000-4000-8000-000000000001","lastSyncDate":null,"me":true,"model":"26A428","name":"","platform":3}';
const D_PHONE = `{"deviceIdentifier":"${P2}","lastSyncDate":1789837200,"me":false,"model":"24A437","name":"","platform":2}`;
const D_PAD = `{"deviceIdentifier":"${P3}","lastSyncDate":1789664400,"me":false,"model":"24A437","name":"Linh's iPad","platform":1}`;
const D_PHONE_NAMED = `{"deviceIdentifier":"${P2}","lastSyncDate":1789837200,"me":false,"model":"24A437","name":"Linh's iPhone","platform":2}`;
const D_UNK =
  '{"deviceIdentifier":"00000000-0000-4000-8000-000000000004","lastSyncDate":null,"me":false,"model":null,"name":"","platform":null}';

const record = (o: Record<string, unknown>): string =>
  JSON.stringify({
    appVersion: null,
    build: null,
    reason: null,
    ...o,
  });

const R1 = record({
  bundleId: "com.apple.springboard.home",
  device: P2,
  focus: "start",
  offset: 32,
  segment: S,
  ts: 1789833600,
});
const R2 = record({
  bundleId: "com.apple.springboard.home",
  device: P2,
  focus: "end",
  offset: 108,
  segment: S,
  ts: 1789833660,
});
const R3 = record({
  bundleId: "com.apple.mobilesafari",
  device: P2,
  focus: "start",
  offset: 184,
  segment: S,
  ts: 1789833660,
});
const R4 = record({
  bundleId: "com.apple.mobilesafari",
  device: P2,
  focus: "end",
  offset: 260,
  segment: S,
  ts: 1789833960,
});
const R5 = record({
  bundleId: "com.burbn.instagram",
  device: P2,
  focus: "start",
  offset: 336,
  segment: S,
  ts: 1789833960,
});
const R6 = record({
  bundleId: "com.apple.SleepLockScreen",
  device: P2,
  focus: "start",
  offset: 412,
  segment: S,
  ts: 1789834200,
});
const R7 = record({
  bundleId: "com.apple.SleepLockScreen",
  device: P2,
  focus: "end",
  offset: 488,
  segment: S,
  ts: 1789834260,
});
const R8 = record({
  bundleId: "com.apple.MobileSMS",
  device: P2,
  focus: "start",
  offset: 564,
  segment: S,
  ts: 1789834260,
});
const R9 = record({
  bundleId: "com.apple.mobilenotes",
  device: P3,
  focus: "start",
  offset: 32,
  segment: T,
  ts: 1789833600,
});
const R10 = record({
  bundleId: "com.apple.mobilenotes",
  device: P3,
  focus: "end",
  offset: 108,
  segment: T,
  ts: 1789834200,
});
const R11 = record({
  bundleId: "com.apple.finder",
  device: "00000000-0000-4000-8000-000000000001",
  focus: "start",
  offset: 32,
  segment: "000000000000003",
  ts: 1789833600,
});
const R12 = record({
  bundleId: "com.apple.finder",
  device: "00000000-0000-4000-8000-000000000001",
  focus: "end",
  offset: 108,
  segment: "000000000000003",
  ts: 1789833660,
});
const R13 = record({
  bundleId: "com.apple.MobileSMS",
  device: P2,
  focus: "end",
  offset: 640,
  segment: S,
  ts: 1789834560,
});
const E1 = `{"error":"parse","offset":148,"segment":"${S}"}`;

const ALL = [R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12];

interface Ctx {
  calls: Ref.Ref<number>;
  sinces: Ref.Ref<ReadonlyArray<ReadonlyMap<string, number>>>;
  devicesRef: Ref.Ref<ReadonlyArray<string>>;
  recordsRef: Ref.Ref<ReadonlyArray<string>>;
}

const run = <A, E>(
  spec: {
    devices:
      | ReadonlyArray<string>
      | Effect.Effect<ReadonlyArray<string>, BiomeExitError>
      | "ref";
    records:
      | ReadonlyArray<string>
      | Effect.Effect<ReadonlyArray<string>, BiomeExitError>
      | "ref";
    store?: Layer.Layer<Store, never, Store>;
  },
  macos: string,
  inside: (ctx: Ctx) => Effect.Effect<A, E, Helper | Store | MacIdentity>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const calls = yield* Ref.make(0);
      const sinces = yield* Ref.make<
        ReadonlyArray<ReadonlyMap<string, number>>
      >([]);
      const devicesRef = yield* Ref.make<ReadonlyArray<string>>([]);
      const recordsRef = yield* Ref.make<ReadonlyArray<string>>([]);
      const deviceEff: Effect.Effect<readonly string[], BiomeExitError> =
        spec.devices === "ref"
          ? Ref.get(devicesRef)
          : Effect.isEffect(spec.devices)
            ? spec.devices
            : Effect.succeed(spec.devices);
      const recordEff: Effect.Effect<readonly string[], BiomeExitError> =
        spec.records === "ref"
          ? Ref.get(recordsRef)
          : Effect.isEffect(spec.records)
            ? spec.records
            : Effect.succeed(spec.records);
      const stubHelper = Helper.Test({
        biomeDevices: () =>
          Ref.update(calls, (n) => n + 1).pipe(Effect.andThen(deviceEff)),
        biomeRecords: (_path, since) =>
          Ref.update(sinces, (ss) => [...ss, since]).pipe(
            Effect.andThen(recordEff),
          ),
      });
      const stubMac = Layer.succeed(
        MacIdentity,
        new MacIdentity({
          name: Effect.succeed("Studio"),
          hardwareUuid: Effect.succeed("mac-1"),
          macosVersion: Effect.succeed(macos),
        }),
      );
      return yield* inside({ calls, sinces, devicesRef, recordsRef }).pipe(
        Effect.provide(
          Layer.mergeAll(
            stubHelper,
            Store.Test,
            stubMac,
            spec.store === undefined
              ? Layer.empty
              : Layer.provide(spec.store, Store.Test),
          ),
        ),
      );
    }).pipe(Effect.provide(TestContext.TestContext)),
  );

const spyStore = (
  batches: Ref.Ref<ReadonlyArray<ImportBatch>>,
  failNext: Ref.Ref<boolean>,
): Layer.Layer<Store, never, Store> =>
  Layer.effect(
    Store,
    Effect.map(
      Store,
      (s) =>
        new Store({
          ...s,
          writeImportBatch: (batch) =>
            Ref.getAndSet(failNext, false).pipe(
              Effect.flatMap((fail) =>
                fail
                  ? Effect.fail(new StoreError({ cause: "disk full" }))
                  : Ref.update(batches, (bs) => [...bs, batch]).pipe(
                      Effect.andThen(s.writeImportBatch(batch)),
                    ),
              ),
            ),
        }),
    ),
  );

const t = (s: string) => DateTime.unsafeMake(s);

const rows = Effect.gen(function* () {
  const store = yield* Store;
  const devices = yield* store.listDevices();
  const nameOf = new Map(devices.map((d) => [d.id, d.name]));
  const result = yield* store.readActivities({
    from: t("2026-09-19T00:00:00.000Z"),
    to: t("2026-09-20T00:00:00.000Z"),
  });
  return result.map((a) => ({
    device: nameOf.get(a.deviceId),
    appName: a.appName,
    bundleId: a.bundleId,
    title: a.title,
    url: a.url,
    startedAt: DateTime.formatIso(a.startedAt),
    endedAt: DateTime.formatIso(a.endedAt),
  }));
});

describe("importer", () => {
  it("iPhone and iPad DevicePeer rows become Devices, Mac and unknown platforms are skipped", async () => {
    // Given: DevicePeer rows for a Mac, an iPhone, an iPad, and an unknown
    // When
    const devices = await run(
      { devices: [D_MAC, D_PHONE, D_PAD, D_UNK], records: [] },
      "27.0",
      () =>
        Effect.gen(function* () {
          yield* importOnce("/stub");
          const store = yield* Store;
          return yield* store.listDevices();
        }),
    );
    // Then
    expect(
      devices.map((d) => ({
        kind: d.kind,
        name: d.name,
        externalId: d.externalId,
      })),
    ).toEqual([
      { kind: "ipad", name: "Linh's iPad", externalId: P3 },
      { kind: "iphone", name: "iPhone", externalId: P2 },
    ]);
  });

  it("a renamed DevicePeer shows its new name and an empty name falls back only while empty", async () => {
    // Given: an iPhone peer first seen with an empty name
    // When: the peer reports a name, then an empty name again
    const result = await run({ devices: "ref", records: [] }, "27.0", (ctx) =>
      Effect.gen(function* () {
        yield* Ref.set(ctx.devicesRef, [D_MAC, D_PHONE]);
        yield* importOnce("/stub");
        const store = yield* Store;
        const first = yield* store.listDevices();
        yield* Ref.set(ctx.devicesRef, [D_MAC, D_PHONE_NAMED]);
        yield* importOnce("/stub");
        const second = yield* store.listDevices();
        yield* Ref.set(ctx.devicesRef, [D_MAC, D_PHONE]);
        yield* importOnce("/stub");
        const third = yield* store.listDevices();
        return { first, second, third };
      }),
    );
    // Then
    const names = (ds: ReadonlyArray<{ name: string }>) =>
      ds.map((d) => d.name);
    expect(names(result.first)).toEqual(["iPhone"]);
    expect(names(result.second)).toEqual(["Linh's iPhone"]);
    expect(names(result.third)).toEqual(["iPhone"]);
    expect(result.second[0]?.id).toBe(result.first[0]?.id);
    expect(result.third[0]?.id).toBe(result.first[0]?.id);
    expect(result.first.length).toBe(1);
    expect(result.second.length).toBe(1);
    expect(result.third.length).toBe(1);
  });

  it("a start and its end become one Activity, an open start closes at the next record", async () => {
    // Given: an iPhone and an iPad with the shared record stream
    // When
    const activities = await run(
      { devices: [D_MAC, D_PHONE, D_PAD], records: ALL },
      "27.0",
      () =>
        Effect.gen(function* () {
          yield* importOnce("/stub");
          return yield* rows;
        }),
    );
    // Then
    expect(activities).toEqual([
      {
        device: "Linh's iPad",
        appName: "com.apple.mobilenotes",
        bundleId: "com.apple.mobilenotes",
        title: null,
        url: null,
        startedAt: "2026-09-19T16:00:00.000Z",
        endedAt: "2026-09-19T16:10:00.000Z",
      },
      {
        device: "iPhone",
        appName: "com.apple.mobilesafari",
        bundleId: "com.apple.mobilesafari",
        title: null,
        url: null,
        startedAt: "2026-09-19T16:01:00.000Z",
        endedAt: "2026-09-19T16:06:00.000Z",
      },
      {
        device: "iPhone",
        appName: "com.burbn.instagram",
        bundleId: "com.burbn.instagram",
        title: null,
        url: null,
        startedAt: "2026-09-19T16:06:00.000Z",
        endedAt: "2026-09-19T16:10:00.000Z",
      },
    ]);
  });

  it("system screens are dropped and still close an open start", async () => {
    // Given: a Safari stretch interrupted by the system screens
    const records = [
      record({
        bundleId: "com.apple.mobilesafari",
        device: P2,
        focus: "start",
        offset: 32,
        segment: S,
        ts: 1789833600,
      }),
      record({
        bundleId: "com.apple.control-center",
        device: P2,
        focus: "start",
        offset: 108,
        segment: S,
        ts: 1789833720,
      }),
      record({
        bundleId: "com.apple.control-center",
        device: P2,
        focus: "end",
        offset: 184,
        segment: S,
        ts: 1789833780,
      }),
      record({
        bundleId: "com.apple.ClockAngel",
        device: P2,
        focus: "start",
        offset: 260,
        segment: S,
        ts: 1789833780,
      }),
      record({
        bundleId: "com.apple.ClockAngel",
        device: P2,
        focus: "end",
        offset: 336,
        segment: S,
        ts: 1789833840,
      }),
      record({
        bundleId: "com.apple.springboard.notifications",
        device: P2,
        focus: "start",
        offset: 412,
        segment: S,
        ts: 1789833840,
      }),
      record({
        bundleId: "com.apple.springboard.notifications",
        device: P2,
        focus: "end",
        offset: 488,
        segment: S,
        ts: 1789833900,
      }),
    ];
    // When
    const activities = await run({ devices: [D_PHONE], records }, "27.0", () =>
      Effect.gen(function* () {
        yield* importOnce("/stub");
        return yield* rows;
      }),
    );
    // Then
    expect(activities).toEqual([
      {
        device: "iPhone",
        appName: "com.apple.mobilesafari",
        bundleId: "com.apple.mobilesafari",
        title: null,
        url: null,
        startedAt: "2026-09-19T16:00:00.000Z",
        endedAt: "2026-09-19T16:02:00.000Z",
      },
    ]);
  });

  it("a span under one second is not written", async () => {
    // Given: a start and its end half a second apart
    const records = [
      record({
        bundleId: "com.apple.mobilesafari",
        device: P2,
        focus: "start",
        offset: 32,
        segment: S,
        ts: 1789833600,
      }),
      record({
        bundleId: "com.apple.mobilesafari",
        device: P2,
        focus: "end",
        offset: 108,
        segment: S,
        ts: 1789833600.5,
      }),
    ];
    // When
    const activities = await run({ devices: [D_PHONE], records }, "27.0", () =>
      Effect.gen(function* () {
        yield* importOnce("/stub");
        return yield* rows;
      }),
    );
    // Then
    expect(activities).toEqual([]);
  });

  it("another macOS version does not run and records not tested", async () => {
    // Given: sw_vers reports 26.6.2
    // When
    const result = await run(
      { devices: [D_PHONE], records: ALL },
      "26.6.2",
      (ctx) =>
        Effect.gen(function* () {
          yield* importOnce("/stub");
          const store = yield* Store;
          return {
            calls: yield* Ref.get(ctx.calls),
            activities: yield* rows,
            status: yield* store.getSetting("importer.status"),
          };
        }),
    );
    // Then
    expect(result.calls).toBe(0);
    expect(result.activities).toEqual([]);
    expect(JSON.parse(Option.getOrElse(result.status, () => ""))).toEqual({
      state: "notTested",
      at: "2026-09-19T17:30:00.000Z",
      macosVersion: "26.6.2",
    });
  });

  it("without Full Disk Access nothing is written", async () => {
    // Given: biome devices exits 3, the helper's Full Disk Access code
    // When
    const result = await run(
      {
        devices: Effect.fail(
          new BiomeExitError({ code: 3, stderr: "full disk access needed\n" }),
        ),
        records: [],
      },
      "27.0",
      () =>
        Effect.gen(function* () {
          yield* importOnce("/stub");
          const store = yield* Store;
          return {
            status: yield* store.getSetting("importer.status"),
            devices: yield* store.listDevices(),
          };
        }),
    );
    // Then
    expect(result.status).toEqual(Option.none());
    expect(result.devices).toEqual([]);
  });

  it("a missing remote folder records broken with the helper's reason", async () => {
    // Given: biome records exits 4 after the devices import
    // When
    const result = await run(
      {
        devices: [D_PHONE, D_PAD],
        records: Effect.fail(
          new BiomeExitError({
            code: 4,
            stderr: "no App.InFocus remote folder\n",
          }),
        ),
      },
      "27.0",
      () =>
        Effect.gen(function* () {
          yield* importOnce("/stub");
          const store = yield* Store;
          return {
            devices: yield* store.listDevices(),
            status: yield* store.getSetting("importer.status"),
          };
        }),
    );
    // Then
    expect(result.devices.length).toBe(2);
    expect(JSON.parse(Option.getOrElse(result.status, () => ""))).toEqual({
      state: "broken",
      at: "2026-09-19T17:30:00.000Z",
      reason: "no App.InFocus remote folder",
      devices: [
        { externalId: P2, lastSync: "2026-09-19T17:00:00.000Z" },
        { externalId: P3, lastSync: "2026-09-17T17:00:00.000Z" },
      ],
    });
  });

  it("a parse error line records broken and keeps the good records", async () => {
    // Given: a parse error line between two good records
    // When
    const result = await run(
      { devices: [D_PHONE], records: [E1, R3, R4] },
      "27.0",
      () =>
        Effect.gen(function* () {
          yield* importOnce("/stub");
          const store = yield* Store;
          return {
            activities: yield* rows,
            status: yield* store.getSetting("importer.status"),
          };
        }),
    );
    // Then
    expect(result.activities.length).toBe(1);
    expect(result.activities[0]?.appName).toBe("com.apple.mobilesafari");
    expect(JSON.parse(Option.getOrElse(result.status, () => ""))).toEqual({
      state: "broken",
      at: "2026-09-19T17:30:00.000Z",
      reason: "parse error in 000000000000001 at 148",
      devices: [{ externalId: P2, lastSync: "2026-09-19T17:00:00.000Z" }],
    });
  });

  it("a good run records ok with each device's last sync", async () => {
    // Given: an iPhone and an iPad, all records clean
    // When
    const status = await run(
      { devices: [D_MAC, D_PHONE, D_PAD], records: ALL },
      "27.0",
      () =>
        Effect.gen(function* () {
          yield* importOnce("/stub");
          const store = yield* Store;
          return yield* store.getSetting("importer.status");
        }),
    );
    // Then
    expect(JSON.parse(Option.getOrElse(status, () => ""))).toEqual({
      state: "ok",
      at: "2026-09-19T17:30:00.000Z",
      devices: [
        { externalId: P2, lastSync: "2026-09-19T17:00:00.000Z" },
        { externalId: P3, lastSync: "2026-09-17T17:00:00.000Z" },
      ],
    });
  });

  it("a second run imports nothing new and passes each Device's Progress", async () => {
    // Given: the same devices and records imported twice
    // When
    const result = await run(
      { devices: [D_MAC, D_PHONE, D_PAD], records: ALL },
      "27.0",
      (ctx) =>
        Effect.gen(function* () {
          yield* importOnce("/stub");
          yield* importOnce("/stub");
          const store = yield* Store;
          return {
            activities: yield* rows,
            progressP2: yield* store.getSetting(importProgressKey(P2)),
            progressP3: yield* store.getSetting(importProgressKey(P3)),
            since: yield* store.getSetting("importer.since"),
            sinces: yield* Ref.get(ctx.sinces),
          };
        }),
    );
    // Then
    expect(result.activities.length).toBe(3);
    expect(JSON.parse(Option.getOrElse(result.progressP2, () => ""))).toEqual({
      segment: S,
      offset: 488,
      ts: 1789834260,
    });
    expect(JSON.parse(Option.getOrElse(result.progressP3, () => ""))).toEqual({
      segment: T,
      offset: 108,
      ts: 1789834200,
    });
    expect(result.since).toEqual(Option.none());
    expect(result.sinces).toEqual([
      new Map(),
      new Map([
        [P2, 1789834260],
        [P3, 1789834200],
      ]),
    ]);
  });

  it("a Device without Progress does not stop the others' incremental reads", async () => {
    // Given: an iPhone with records and an iPad with none
    // When: three import runs
    const result = await run(
      {
        devices: [D_MAC, D_PHONE, D_PAD],
        records: ALL.filter((r) => r.includes(P2)),
      },
      "27.0",
      (ctx) =>
        Effect.gen(function* () {
          yield* importOnce("/stub");
          yield* importOnce("/stub");
          yield* importOnce("/stub");
          const store = yield* Store;
          return {
            sinces: yield* Ref.get(ctx.sinces),
            progressP3: yield* store.getSetting(importProgressKey(P3)),
          };
        }),
    );
    // Then
    expect(result.sinces).toEqual([
      new Map(),
      new Map([[P2, 1789834260]]),
      new Map([[P2, 1789834260]]),
    ]);
    expect(result.progressP3).toEqual(Option.none());
  });

  it("an open start at the end of the stream is written once its end arrives", async () => {
    // Given: a run that leaves MobileSMS open, then a second run with its end
    // When
    const activities = await run(
      { devices: [D_PHONE, D_PAD], records: "ref" },
      "27.0",
      (ctx) =>
        Effect.gen(function* () {
          yield* Ref.set(ctx.recordsRef, ALL);
          yield* importOnce("/stub");
          yield* Ref.set(ctx.recordsRef, [...ALL, R13]);
          yield* importOnce("/stub");
          return yield* rows;
        }),
    );
    // Then
    expect(activities.length).toBe(4);
    expect(activities[3]).toEqual({
      device: "iPhone",
      appName: "com.apple.MobileSMS",
      bundleId: "com.apple.MobileSMS",
      title: null,
      url: null,
      startedAt: "2026-09-19T16:11:00.000Z",
      endedAt: "2026-09-19T16:16:00.000Z",
    });
  });

  it("a partial device failure keeps the emitted records and records broken", async () => {
    // Given: biome records emits Safari's records then exits 6 on the iPad folder
    // When
    const result = await run(
      {
        devices: [D_PHONE, D_PAD],
        records: Effect.fail(
          new BiomeExitError({
            code: 6,
            stderr: "cannot list iPad folder\n",
            lines: [R3, R4],
          }),
        ),
      },
      "27.0",
      () =>
        Effect.gen(function* () {
          yield* importOnce("/stub");
          const store = yield* Store;
          return {
            activities: yield* rows,
            status: yield* store.getSetting("importer.status"),
          };
        }),
    );
    // Then
    expect(result.activities).toEqual([
      {
        device: "iPhone",
        appName: "com.apple.mobilesafari",
        bundleId: "com.apple.mobilesafari",
        title: null,
        url: null,
        startedAt: "2026-09-19T16:01:00.000Z",
        endedAt: "2026-09-19T16:06:00.000Z",
      },
    ]);
    expect(JSON.parse(Option.getOrElse(result.status, () => ""))).toEqual({
      state: "broken",
      at: "2026-09-19T17:30:00.000Z",
      reason: "cannot list iPad folder",
      devices: [
        { externalId: P2, lastSync: "2026-09-19T17:00:00.000Z" },
        { externalId: P3, lastSync: "2026-09-17T17:00:00.000Z" },
      ],
    });
  });

  it("a device read failure keeps the previous sync data", async () => {
    // Given: one good import, then biome devices exits 5
    const devicesRef = Ref.unsafeMake<
      Effect.Effect<ReadonlyArray<string>, BiomeExitError>
    >(Effect.succeed([D_PHONE, D_PAD]));
    // When
    const status = await run(
      {
        devices: Ref.get(devicesRef).pipe(Effect.flatten),
        records: ALL,
      },
      "27.0",
      () =>
        Effect.gen(function* () {
          yield* importOnce("/stub");
          yield* Ref.set(
            devicesRef,
            Effect.fail(
              new BiomeExitError({
                code: 5,
                stderr: "cannot read DevicePeer: locked\n",
              }),
            ),
          );
          yield* importOnce("/stub");
          const store = yield* Store;
          return yield* store.getSetting("importer.status");
        }),
    );
    // Then
    expect(JSON.parse(Option.getOrElse(status, () => ""))).toEqual({
      state: "broken",
      at: "2026-09-19T17:30:00.000Z",
      reason: "cannot read DevicePeer: locked",
      devices: [
        { externalId: P2, lastSync: "2026-09-19T17:00:00.000Z" },
        { externalId: P3, lastSync: "2026-09-17T17:00:00.000Z" },
      ],
    });
  });

  it("an unexpected failure records broken and keeps the prior sync data", async () => {
    // Given: one good import, then biome devices exits with an unhandled code
    const devicesRef = Ref.unsafeMake<
      Effect.Effect<ReadonlyArray<string>, BiomeExitError>
    >(Effect.succeed([D_PHONE, D_PAD]));
    // When
    const status = await run(
      {
        devices: Ref.get(devicesRef).pipe(Effect.flatten),
        records: ALL,
      },
      "27.0",
      () =>
        Effect.gen(function* () {
          yield* importOnce("/stub");
          yield* Ref.set(
            devicesRef,
            Effect.fail(
              new BiomeExitError({ code: 9, stderr: "unknown failure\n" }),
            ),
          );
          yield* importTick("/stub");
          const store = yield* Store;
          return yield* store.getSetting("importer.status");
        }),
    );
    // Then
    expect(JSON.parse(Option.getOrElse(status, () => ""))).toEqual({
      state: "broken",
      at: "2026-09-19T17:30:00.000Z",
      reason: "helper biome exited 9: unknown failure",
      devices: [
        { externalId: P2, lastSync: "2026-09-19T17:00:00.000Z" },
        { externalId: P3, lastSync: "2026-09-17T17:00:00.000Z" },
      ],
    });
  });

  it("imports a real biome records sample file", async () => {
    // Given: the golden sample at test/fixtures/biome-records.sample.jsonl
    const lines = readFileSync(
      new URL("./fixtures/biome-records.sample.jsonl", import.meta.url),
      "utf8",
    )
      .trim()
      .split("\n");
    // When
    const activities = await run(
      { devices: [D_MAC, D_PHONE, D_PAD], records: lines },
      "27.0",
      () =>
        Effect.gen(function* () {
          yield* importOnce("/stub");
          return yield* rows;
        }),
    );
    // Then
    expect(activities).toEqual([
      {
        device: "Linh's iPad",
        appName: "com.apple.mobilenotes",
        bundleId: "com.apple.mobilenotes",
        title: null,
        url: null,
        startedAt: "2026-09-19T16:00:00.000Z",
        endedAt: "2026-09-19T16:10:00.000Z",
      },
      {
        device: "iPhone",
        appName: "com.apple.mobilesafari",
        bundleId: "com.apple.mobilesafari",
        title: null,
        url: null,
        startedAt: "2026-09-19T16:01:00.000Z",
        endedAt: "2026-09-19T16:06:00.000Z",
      },
      {
        device: "iPhone",
        appName: "com.burbn.instagram",
        bundleId: "com.burbn.instagram",
        title: null,
        url: null,
        startedAt: "2026-09-19T16:06:00.000Z",
        endedAt: "2026-09-19T16:10:00.000Z",
      },
    ]);
  });

  it("a failed Import batch leaves no Activities and the next run writes them once", async () => {
    // Given: the first batch write fails
    const batches = await Effect.runPromise(
      Ref.make<ReadonlyArray<ImportBatch>>([]),
    );
    const failNext = await Effect.runPromise(Ref.make(true));
    const result = await run(
      {
        devices: [D_MAC, D_PHONE, D_PAD],
        records: ALL,
        store: spyStore(batches, failNext),
      },
      "27.0",
      () =>
        Effect.gen(function* () {
          // When
          const first = yield* Effect.either(importOnce("/stub"));
          const store = yield* Store;
          const afterFail = (yield* store.readActivities({
            from: t("2026-09-19T00:00:00.000Z"),
            to: t("2026-09-20T00:00:00.000Z"),
          })).length;
          const second = yield* Effect.either(importOnce("/stub"));
          const afterRetry = (yield* store.readActivities({
            from: t("2026-09-19T00:00:00.000Z"),
            to: t("2026-09-20T00:00:00.000Z"),
          })).length;
          return { first, second, afterFail, afterRetry };
        }),
    );
    const written = await Effect.runPromise(Ref.get(batches));
    // Then
    expect(Either.isLeft(result.first)).toBe(true);
    if (Either.isLeft(result.first)) {
      expect(result.first.left).toBeInstanceOf(StoreError);
    }
    expect(Either.isRight(result.second)).toBe(true);
    expect(result.afterFail).toBe(0);
    expect(result.afterRetry).toBe(3);
    expect(written).toHaveLength(1);
    expect(written[0]?.activities).toHaveLength(3);
  });

  it("a run with no new records writes only the status", async () => {
    // Given: a first run already imported every record
    const batches = await Effect.runPromise(
      Ref.make<ReadonlyArray<ImportBatch>>([]),
    );
    const failNext = await Effect.runPromise(Ref.make(false));
    // When
    await run(
      {
        devices: [D_MAC, D_PHONE, D_PAD],
        records: ALL,
        store: spyStore(batches, failNext),
      },
      "27.0",
      () =>
        Effect.gen(function* () {
          yield* importOnce("/stub");
          yield* importOnce("/stub");
        }),
    );
    const written = await Effect.runPromise(Ref.get(batches));
    // Then
    expect(written).toHaveLength(2);
    expect(written[1]?.activities).toEqual([]);
    expect(written[1]?.settings.map((s) => s.key)).toEqual([importStatusKey]);
  });

  it("a failed Import batch records broken and keeps the prior sync data", async () => {
    // Given: a successful run, then a failing batch write
    const batches = await Effect.runPromise(
      Ref.make<ReadonlyArray<ImportBatch>>([]),
    );
    const failNext = await Effect.runPromise(Ref.make(false));
    const { status, count } = await run(
      {
        devices: [D_MAC, D_PHONE, D_PAD],
        records: ALL,
        store: spyStore(batches, failNext),
      },
      "27.0",
      () =>
        Effect.gen(function* () {
          yield* importOnce("/stub");
          // When
          yield* Ref.set(failNext, true);
          yield* importTick("/stub");
          const store = yield* Store;
          return {
            status: yield* store.getSetting(importStatusKey),
            count: (yield* store.readActivities({
              from: t("2026-09-19T00:00:00.000Z"),
              to: t("2026-09-20T00:00:00.000Z"),
            })).length,
          };
        }),
    );
    // Then
    expect(count).toBe(3);
    expect(Option.isSome(status)).toBe(true);
    if (Option.isSome(status)) {
      const parsed = Schema.decodeUnknownSync(ImportResult)(status.value);
      expect(parsed.state).toBe("broken");
      if (parsed.state === "broken") {
        expect(parsed.devices).toEqual([
          {
            externalId: P2,
            lastSync: DateTime.unsafeMake("2026-09-19T17:00:00.000Z"),
          },
          {
            externalId: P3,
            lastSync: DateTime.unsafeMake("2026-09-17T17:00:00.000Z"),
          },
        ]);
      }
    }
  });
});
