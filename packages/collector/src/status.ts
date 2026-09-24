import { Store, type StoreError } from "@clocktrace/core";
import { DateTime, Effect, Option, Schema } from "effect";
import type { ParseError } from "effect/ParseResult";
import type { App } from "./app.js";
import { configuredDbPath } from "./config.js";
import {
  browserName,
  type GrantItem,
  GrantKind,
  grantPicture,
  noAnswerNote,
} from "./grant.js";
import type { Helper, HelperExitedError } from "./helper.js";
import { ImportResult, importStatusKey, readProgress } from "./importer.js";
import { syncStaleAfterMillis } from "./importer-rules.js";
import { Launchd, type LaunchdError } from "./launchd.js";
import type { CollectorPaths } from "./paths.js";

export const PermissionLine = Schema.Struct({
  name: Schema.String,
  state: Schema.Literal("granted", "denied", "not checked"),
  note: Schema.NullOr(Schema.String),
  checkedAt: Schema.NullOr(Schema.DateTimeUtc),
  kind: GrantKind,
  bundleId: Schema.NullOr(Schema.String),
});

export type PermissionLine = Schema.Schema.Type<typeof PermissionLine>;

export const IosImport = Schema.Union(
  Schema.Struct({
    state: Schema.Literal("ok"),
    at: Schema.DateTimeUtc,
  }),
  Schema.Struct({
    state: Schema.Literal("broken"),
    reason: Schema.String,
  }),
  Schema.Struct({
    state: Schema.Literal("notTested"),
    macosVersion: Schema.String,
  }),
);

export type IosImport = Schema.Schema.Type<typeof IosImport>;

export const DeviceStatus = Schema.Struct({
  name: Schema.String,
  kind: Schema.Literal("iphone", "ipad"),
  lastSync: Schema.NullOr(Schema.DateTimeUtc),
  sync: Schema.Literal("synced", "stale", "never"),
  dataUpTo: Schema.NullOr(Schema.DateTimeUtc),
  lastActivity: Schema.NullOr(Schema.DateTimeUtc),
});

export type DeviceStatus = Schema.Schema.Type<typeof DeviceStatus>;

export const Status = Schema.Struct({
  collector: Schema.Literal("running", "stopped"),
  app: Schema.Literal("present", "missing"),
  permissions: Schema.Array(PermissionLine),
  lastActivity: Schema.NullOr(Schema.DateTimeUtc),
  iosImport: Schema.NullOr(IosImport),
  devices: Schema.Array(DeviceStatus),
  databasePath: Schema.String,
});

export type Status = Schema.Schema.Type<typeof Status>;

export const permissionLine = (item: GrantItem): PermissionLine => {
  const line = (
    state: PermissionLine["state"],
    note: string | null,
  ): PermissionLine => ({
    name: item.name,
    state,
    note,
    checkedAt: item.checkedAt,
    kind: item.kind,
    bundleId: item.bundleId,
  });
  const browser =
    item.bundleId === null ? item.name : browserName(item.bundleId);
  switch (item.state) {
    case "granted":
      return line("granted", null);
    case "notRunning":
      return line("not checked", `${browser} is closed`);
    case "noAnswer":
      return line("not checked", noAnswerNote(browser));
    case "notChecked":
      return line("not checked", null);
    case "noBrowser":
      return line("not checked", "no browser used yet");
    default:
      return line("denied", item.loss);
  }
};

export const readStatus = (): Effect.Effect<
  Status,
  HelperExitedError | ParseError | StoreError | LaunchdError,
  Store | Launchd | Helper | App | CollectorPaths
> =>
  Effect.gen(function* () {
    const picture = yield* grantPicture();
    const store = yield* Store;
    const launchd = yield* Launchd;
    const collector = yield* launchd.state();
    const last = yield* store.latestActivityEnd();
    const databasePath = yield* Effect.orDie(configuredDbPath);
    let iosImport: IosImport | null = null;
    const devices: Array<DeviceStatus> = [];
    if (
      picture.items.some(
        (i) => i.kind === "fullDiskAccess" && i.state === "granted",
      )
    ) {
      const raw = yield* store.getSetting(importStatusKey);
      const blob = Option.isSome(raw)
        ? yield* Effect.option(Schema.decodeUnknown(ImportResult)(raw.value))
        : Option.none<ImportResult>();
      if (Option.isSome(blob)) {
        const result = blob.value;
        iosImport =
          result.state === "ok"
            ? { state: "ok", at: result.at }
            : result.state === "broken"
              ? { state: "broken", reason: result.reason }
              : { state: "notTested", macosVersion: result.macosVersion };
        const now = yield* DateTime.now;
        if (result.state !== "notTested") {
          const lastSyncs = new Map(
            result.devices.map((d) => [d.externalId, d.lastSync] as const),
          );
          for (const device of yield* store.listDevices()) {
            if (device.kind === "mac") {
              continue;
            }
            const lastSync = lastSyncs.get(device.externalId) ?? null;
            const lastActivity = yield* store.latestActivityEnd(device.id);
            const progress = yield* readProgress(store, device.externalId);
            devices.push({
              name: device.name,
              kind: device.kind,
              lastSync,
              sync:
                lastSync === null
                  ? "never"
                  : now.epochMillis - lastSync.epochMillis >
                      syncStaleAfterMillis
                    ? "stale"
                    : "synced",
              dataUpTo: Option.getOrNull(
                Option.map(progress, (p) => DateTime.unsafeMake(p.ts * 1000)),
              ),
              lastActivity: Option.getOrNull(lastActivity),
            });
          }
        }
      }
    }
    return {
      collector,
      app: picture.app,
      permissions: picture.items.map(permissionLine),
      lastActivity: Option.getOrNull(last),
      iosImport,
      devices,
      databasePath,
    };
  });

/** Said under the device rows while one syncs: Apple sends App.InFocus records hours late (ADR 0004). */
export const lateHint =
  "iPhone and iPad data comes from Apple a few hours late.";

const pad = (n: number): string => String(n).padStart(2, "0");

const stamp = (
  t: DateTime.Utc,
): Effect.Effect<string, never, DateTime.CurrentTimeZone> =>
  Effect.map(DateTime.setZoneCurrent(t), (zoned) => {
    const parts = DateTime.toParts(zoned);
    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hours)}:${pad(parts.minutes)}`;
  });

export const statusLines = (
  s: Status,
): Effect.Effect<ReadonlyArray<string>, never, DateTime.CurrentTimeZone> =>
  Effect.gen(function* () {
    const lines = [
      s.collector === "running"
        ? "collector: running"
        : "collector: stopped, run clocktrace start",
      ...(s.app === "missing" ? ["app: missing, run clocktrace setup"] : []),
    ];
    for (const p of s.permissions) {
      lines.push(
        `${p.name}: ${p.state}${p.note === null ? "" : `, ${p.note}`}${
          p.checkedAt === null
            ? ""
            : `, last checked ${yield* stamp(p.checkedAt)}`
        }`,
      );
    }
    if (s.iosImport !== null) {
      lines.push(
        s.iosImport.state === "ok"
          ? `iOS import: ok ${yield* stamp(s.iosImport.at)}`
          : s.iosImport.state === "broken"
            ? `iOS import: broken: ${s.iosImport.reason}`
            : `iOS import: not tested on macOS ${s.iosImport.macosVersion}`,
      );
    }
    for (const d of s.devices) {
      lines.push(
        d.sync === "synced" && d.dataUpTo !== null
          ? `${d.name}: data up to ${yield* stamp(d.dataUpTo)}`
          : d.sync === "synced"
            ? `${d.name}: no data yet`
            : d.sync === "stale" && d.lastSync !== null
              ? `${d.name}: not syncing since ${yield* stamp(d.lastSync)}`
              : `${d.name}: never synced`,
      );
      lines.push(
        d.lastActivity === null
          ? `${d.name}: last activity none yet`
          : `${d.name}: last activity ${yield* stamp(d.lastActivity)}`,
      );
    }
    if (s.devices.some((d) => d.sync === "synced")) {
      lines.push(lateHint);
    }
    if (s.lastActivity === null) {
      lines.push("last activity: none yet");
    } else {
      lines.push(`last activity: ${yield* stamp(s.lastActivity)}`);
    }
    lines.push(`database: ${s.databasePath}`);
    return lines;
  });
