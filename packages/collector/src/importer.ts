import {
  type NewActivity,
  readPrivate,
  Store,
  type StoreError,
} from "@clocktrace/core";
import {
  Cause,
  DateTime,
  Effect,
  Either,
  Option,
  Schedule,
  Schema,
} from "effect";
import type { ParseError } from "effect/ParseResult";

import { type ActivityWriter, makeActivityWriter } from "./activity-writer.js";
import type { BiomeLine } from "./biome-line.js";
import {
  Helper,
  type HelperExitedError,
  type HelperFailedError,
} from "./helper.js";
import {
  importEvery,
  isDroppedBundleId,
  platformKinds,
  verifiedMacosMajors,
} from "./importer-rules.js";
import {
  MacIdentity,
  type MacIdentityError,
  parseMacosMajor,
} from "./mac-identity.js";

const DeviceSync = Schema.Struct({
  externalId: Schema.String,
  lastSync: Schema.NullOr(Schema.DateTimeUtc),
});

export const ImportResult = Schema.parseJson(
  Schema.Union(
    Schema.Struct({
      state: Schema.Literal("ok"),
      at: Schema.DateTimeUtc,
      devices: Schema.Array(DeviceSync),
    }),
    Schema.Struct({
      state: Schema.Literal("broken"),
      at: Schema.DateTimeUtc,
      reason: Schema.String,
      devices: Schema.Array(DeviceSync),
    }),
    Schema.Struct({
      state: Schema.Literal("notTested"),
      at: Schema.DateTimeUtc,
      macosVersion: Schema.String,
    }),
  ),
);

export type ImportResult = Schema.Schema.Type<typeof ImportResult>;

export const ImportProgress = Schema.parseJson(
  Schema.Struct({
    segment: Schema.String,
    offset: Schema.Number,
    ts: Schema.Number,
  }),
);

export type ImportProgress = Schema.Schema.Type<typeof ImportProgress>;

export const importStatusKey = "importer.status";
export const importProgressKey = (externalId: string): string =>
  `importer.progress.${externalId}`;

const encodeResult = Schema.encodeSync(ImportResult);
const encodeProgress = Schema.encodeSync(ImportProgress);

const lastKnownSyncs = (
  store: Store,
): Effect.Effect<
  Array<{ externalId: string; lastSync: DateTime.Utc | null }>,
  StoreError
> =>
  Effect.gen(function* () {
    const stored = yield* store.getSetting(importStatusKey);
    const prior = yield* Effect.option(
      Schema.decodeUnknown(ImportResult)(Option.getOrElse(stored, () => "")),
    );
    return Option.match(prior, {
      onNone: () => [],
      onSome: (r) => ("devices" in r ? [...r.devices] : []),
    });
  });

export const importOnce = (
  helperPath: string,
): Effect.Effect<
  void,
  | HelperExitedError
  | HelperFailedError
  | ParseError
  | StoreError
  | MacIdentityError,
  Helper | Store | MacIdentity
> =>
  Effect.gen(function* () {
    const helper = yield* Helper;
    const store = yield* Store;
    const mac = yield* MacIdentity;
    const now = yield* DateTime.now;

    const version = yield* mac.macosVersion;
    const verified = Option.exists(parseMacosMajor(version), (m) =>
      verifiedMacosMajors.includes(m),
    );
    if (!verified) {
      yield* store.setSetting(
        importStatusKey,
        encodeResult({
          state: "notTested",
          at: now,
          macosVersion: version,
        }),
      );
      return;
    }

    const deviceRows = yield* Effect.either(helper.biomeDevices(helperPath));
    if (Either.isLeft(deviceRows)) {
      const e = deviceRows.left;
      if (e._tag === "NoFullDiskAccessError") {
        yield* Effect.logInfo("full disk access missing, iOS import skipped");
        return;
      }
      if (e._tag === "DeviceListUnreadableError") {
        yield* store.setSetting(
          importStatusKey,
          encodeResult({
            state: "broken",
            at: now,
            reason: e.reason,
            devices: yield* lastKnownSyncs(store),
          }),
        );
        return;
      }
      return yield* e;
    }

    const devices = new Map<
      string,
      { deviceId: string; lastSync: DateTime.Utc | null }
    >();
    const syncs: Array<{
      externalId: string;
      lastSync: DateTime.Utc | null;
    }> = [];
    for (const row of deviceRows.right) {
      const kind =
        row.platform === null ? undefined : platformKinds[row.platform];
      if (kind === undefined) {
        continue;
      }
      const device = yield* store.upsertDevice({
        kind,
        name:
          row.name === null || row.name === ""
            ? kind === "iphone"
              ? "iPhone"
              : "iPad"
            : row.name,
        externalId: row.deviceIdentifier,
      });
      const lastSync =
        row.lastSyncDate === null
          ? null
          : DateTime.unsafeMake(row.lastSyncDate * 1000);
      devices.set(row.deviceIdentifier, {
        deviceId: device.id,
        lastSync,
      });
      syncs.push({ externalId: row.deviceIdentifier, lastSync });
    }

    const progress = new Map<
      string,
      { segment: string; offset: number; ts: number }
    >();
    for (const externalId of devices.keys()) {
      const stored = yield* store.getSetting(importProgressKey(externalId));
      const decoded = yield* Effect.option(
        Schema.decodeUnknown(ImportProgress)(
          Option.getOrElse(stored, () => ""),
        ),
      );
      if (Option.isSome(decoded)) {
        progress.set(externalId, decoded.value);
      }
    }
    const since = new Map([...progress].map(([id, p]) => [id, p.ts] as const));

    let records: ReadonlyArray<BiomeLine>;
    let reason: string | null = null;
    const recordLines = yield* Effect.either(
      helper.biomeRecords(helperPath, since),
    );
    if (Either.isLeft(recordLines)) {
      const e = recordLines.left;
      if (e._tag === "NoFullDiskAccessError") {
        yield* Effect.logInfo("full disk access missing, iOS import skipped");
        return;
      }
      if (e._tag === "NoBiomeFolderError") {
        yield* store.setSetting(
          importStatusKey,
          encodeResult({
            state: "broken",
            at: now,
            reason: e.reason,
            devices: syncs,
          }),
        );
        return;
      }
      if (e._tag === "FoldersUnreadableError") {
        records = e.records;
        reason = e.reason;
      } else {
        return yield* e;
      }
    } else {
      records = recordLines.right;
    }

    // The Rules are read once per Import batch, after the Device upserts so a
    // Device rule sees this batch's Devices.
    const blank = yield* readPrivate;
    const writers = new Map<string, ActivityWriter<never>>();
    for (const externalId of devices.keys()) {
      writers.set(externalId, yield* makeActivityWriter(Effect.succeed(blank)));
    }
    const next = new Map<
      string,
      { segment: string; offset: number; ts: number }
    >();
    const activities: Array<NewActivity> = [];

    for (const line of records) {
      if ("error" in line) {
        if (reason === null) {
          reason = `parse error in ${line.segment} at ${line.offset}`;
        }
        continue;
      }
      const entry = devices.get(line.device);
      const writer = writers.get(line.device);
      if (entry === undefined || writer === undefined) {
        continue;
      }
      const p = progress.get(line.device);
      if (
        p !== undefined &&
        (line.segment < p.segment ||
          (line.segment === p.segment && line.offset <= p.offset))
      ) {
        continue;
      }
      const ts = DateTime.unsafeMake(line.ts * 1000);
      const closed =
        line.focus === "start"
          ? yield* writer.start({
              deviceId: entry.deviceId,
              bundleId: line.bundleId,
              appName: line.bundleId,
              title: null,
              url: null,
              startedAt: ts,
            })
          : yield* writer.stop(ts);
      if (Option.isSome(closed) && !isDroppedBundleId(closed.value.bundleId)) {
        activities.push(closed.value);
      }
      if (Option.isNone(yield* writer.open)) {
        next.set(line.device, {
          segment: line.segment,
          offset: line.offset,
          ts: line.ts,
        });
      }
    }

    yield* store.writeImportBatch({
      activities,
      settings: [
        ...[...next].map(([externalId, p]) => ({
          key: importProgressKey(externalId),
          value: encodeProgress(p),
        })),
        {
          key: importStatusKey,
          value: encodeResult(
            reason === null
              ? { state: "ok", at: now, devices: syncs }
              : { state: "broken", at: now, reason, devices: syncs },
          ),
        },
      ],
    });

    if (devices.size > 0) {
      yield* Effect.logInfo("iOS import done").pipe(
        Effect.annotateLogs("activities", activities.length),
      );
    }
  });

export const importTick = (
  helperPath: string,
): Effect.Effect<void, never, Helper | Store | MacIdentity> =>
  importOnce(helperPath).pipe(
    Effect.catchAllCause((cause) =>
      Effect.gen(function* () {
        const store = yield* Store;
        const errors = Cause.prettyErrors(cause);
        yield* store.setSetting(
          importStatusKey,
          encodeResult({
            state: "broken",
            at: yield* DateTime.now,
            reason:
              errors.length > 0
                ? errors.map((e) => e.message).join("; ")
                : Cause.pretty(cause),
            devices: yield* lastKnownSyncs(store),
          }),
        );
      }).pipe(
        Effect.catchAllCause(() => Effect.void),
        Effect.andThen(
          Effect.logWarning("import failed").pipe(
            Effect.annotateLogs("cause", Cause.pretty(cause)),
          ),
        ),
      ),
    ),
  );

export const importLoop = (
  helperPath: string,
): Effect.Effect<void, never, Helper | Store | MacIdentity> =>
  importTick(helperPath).pipe(
    Effect.repeat(Schedule.spaced(importEvery)),
    Effect.asVoid,
  );
