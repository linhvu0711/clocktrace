import { Store, type StoreError } from "@clocktrace/core";
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

import { decodeBiomeLine, decodeDevicePeerLine } from "./biome-line.js";
import { minActivityMillis } from "./collector.js";
import {
  type BiomeExitError,
  Helper,
  type HelperExitedError,
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
export const importSinceKey = "importer.since";

interface Open {
  readonly deviceId: string;
  readonly bundleId: string;
  readonly startedAt: DateTime.Utc;
}

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
  | BiomeExitError
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

    const deviceLines = yield* Effect.either(helper.biomeDevices(helperPath));
    if (Either.isLeft(deviceLines)) {
      const e = deviceLines.left;
      if (e._tag === "BiomeExitError") {
        if (e.code === 3) {
          yield* Effect.logInfo("full disk access missing, iOS import skipped");
          return;
        }
        if (e.code === 5) {
          yield* store.setSetting(
            importStatusKey,
            encodeResult({
              state: "broken",
              at: now,
              reason: e.stderr.trim(),
              devices: yield* lastKnownSyncs(store),
            }),
          );
          return;
        }
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
    for (const text of deviceLines.right) {
      const row = yield* decodeDevicePeerLine(text);
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
    const since =
      devices.size > 0 && [...devices.keys()].every((id) => progress.has(id))
        ? Option.some(Math.min(...[...progress.values()].map((p) => p.ts)))
        : Option.none<number>();

    let recordTexts: ReadonlyArray<string>;
    let reason: string | null = null;
    const recordLines = yield* Effect.either(
      helper.biomeRecords(helperPath, since),
    );
    if (Either.isLeft(recordLines)) {
      const e = recordLines.left;
      if (e._tag === "BiomeExitError" && e.code === 4) {
        yield* store.setSetting(
          importStatusKey,
          encodeResult({
            state: "broken",
            at: now,
            reason: e.stderr.trim(),
            devices: syncs,
          }),
        );
        return;
      }
      if (e._tag === "BiomeExitError" && e.code === 6) {
        recordTexts = e.lines ?? [];
        reason = e.stderr.trim() || e.message;
      } else {
        return yield* e;
      }
    } else {
      recordTexts = recordLines.right;
    }

    const open = new Map<string, Open>();
    const next = new Map<
      string,
      { segment: string; offset: number; ts: number }
    >();
    let count = 0;

    const close = (
      externalId: string,
      endedAt: DateTime.Utc,
    ): Effect.Effect<void, ParseError | StoreError> =>
      Effect.gen(function* () {
        const o = open.get(externalId);
        if (o === undefined) {
          return;
        }
        open.delete(externalId);
        if (
          !isDroppedBundleId(o.bundleId) &&
          DateTime.distance(o.startedAt, endedAt) >= minActivityMillis
        ) {
          yield* store.insertActivity({
            deviceId: o.deviceId,
            bundleId: o.bundleId,
            appName: o.bundleId,
            title: null,
            url: null,
            startedAt: o.startedAt,
            endedAt,
          });
          count += 1;
        }
      });

    for (const text of recordTexts) {
      const line = yield* decodeBiomeLine(text);
      if ("error" in line) {
        if (reason === null) {
          reason = `parse error in ${line.segment} at ${line.offset}`;
        }
        continue;
      }
      const entry = devices.get(line.device);
      if (entry === undefined) {
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
      if (line.focus === "start") {
        yield* close(line.device, ts);
        open.set(line.device, {
          deviceId: entry.deviceId,
          bundleId: line.bundleId,
          startedAt: ts,
        });
      } else {
        yield* close(line.device, ts);
      }
      if (open.get(line.device) === undefined) {
        next.set(line.device, {
          segment: line.segment,
          offset: line.offset,
          ts: line.ts,
        });
      }
    }

    for (const [externalId, p] of next) {
      yield* store.setSetting(importProgressKey(externalId), encodeProgress(p));
    }
    const latest = (externalId: string) =>
      next.get(externalId) ?? progress.get(externalId);
    if (
      devices.size > 0 &&
      [...devices.keys()].every((id) => latest(id) !== undefined)
    ) {
      const minTs = Math.min(
        ...[...devices.keys()].map((id) => latest(id)?.ts ?? 0),
      );
      yield* store.setSetting(importSinceKey, String(minTs));
    }

    yield* store.setSetting(
      importStatusKey,
      encodeResult(
        reason === null
          ? { state: "ok", at: now, devices: syncs }
          : { state: "broken", at: now, reason, devices: syncs },
      ),
    );

    if (devices.size > 0) {
      yield* Effect.logInfo("iOS import done").pipe(
        Effect.annotateLogs("activities", count),
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
