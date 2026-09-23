import { Store, type StoreError } from "@clocktrace/core";
import { DateTime, Effect, Option, Schema } from "effect";
import type { ParseError } from "effect/ParseResult";
import { App, appPath } from "./app.js";
import { dbPathConfig } from "./config.js";
import {
  browserName,
  noAnswerNote,
  type PermissionItem,
  permissionItems,
  readSavedGrants,
  saveLiveGrants,
} from "./grant.js";
import { Helper, type HelperExitedError } from "./helper.js";
import { ImportResult, importStatusKey } from "./importer.js";
import { syncStaleAfterMillis } from "./importer-rules.js";
import { Launchd, type LaunchdError } from "./launchd.js";

export const PermissionLine = Schema.Struct({
  name: Schema.String,
  state: Schema.Literal("granted", "denied", "not checked"),
  note: Schema.NullOr(Schema.String),
  checkedAt: Schema.NullOr(Schema.DateTimeUtc),
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

export const permissionLine = (item: PermissionItem): PermissionLine => {
  if (item.state === "granted") {
    return {
      name: item.name,
      state: "granted",
      note: null,
      checkedAt: item.checkedAt,
    };
  }
  if (item.state === "notRunning") {
    const browser =
      item.request.kind === "automation"
        ? browserName(item.request.bundleId)
        : item.name;
    return {
      name: item.name,
      state: "not checked",
      note: `${browser} is closed`,
      checkedAt: item.checkedAt,
    };
  }
  if (item.state === "noAnswer") {
    const browser =
      item.request.kind === "automation"
        ? browserName(item.request.bundleId)
        : item.name;
    return {
      name: item.name,
      state: "not checked",
      note: noAnswerNote(browser),
      checkedAt: item.checkedAt,
    };
  }
  return {
    name: item.name,
    state: "denied",
    note: item.loss,
    checkedAt: item.checkedAt,
  };
};

export const notCheckedLines: ReadonlyArray<PermissionLine> = [
  { name: "accessibility", state: "not checked", note: null, checkedAt: null },
  {
    name: "full disk access",
    state: "not checked",
    note: null,
    checkedAt: null,
  },
];

export const readStatus = (): Effect.Effect<
  Status,
  HelperExitedError | ParseError | StoreError | LaunchdError,
  Store | Launchd | Helper | App
> =>
  Effect.gen(function* () {
    const app = yield* App;
    const helper = yield* Helper;
    const present = yield* app.isInstalled();
    const grants = present
      ? yield* Effect.scoped(helper.permissions(appPath))
      : null;
    const store = yield* Store;
    if (grants !== null) {
      yield* saveLiveGrants(grants, yield* DateTime.now);
    }
    const saved = yield* readSavedGrants();
    const items =
      grants === null
        ? notCheckedLines
        : permissionItems(grants, saved).map(permissionLine);
    const permissions =
      grants !== null && !items.some((p) => p.name.startsWith("automation "))
        ? [
            ...items.slice(0, 1),
            {
              name: "automation",
              state: "not checked" as const,
              note: "no browser used yet",
              checkedAt: null,
            },
            ...items.slice(1),
          ]
        : items;
    const launchd = yield* Launchd;
    const collector = yield* launchd.state();
    const last = yield* store.latestActivityEnd();
    const databasePath = yield* Effect.orDie(dbPathConfig);
    let iosImport: IosImport | null = null;
    const devices: Array<DeviceStatus> = [];
    if (grants?.fullDiskAccess === "granted") {
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
              lastActivity: Option.getOrNull(lastActivity),
            });
          }
        }
      }
    }
    return {
      collector,
      app: present ? "present" : "missing",
      permissions,
      lastActivity: Option.getOrNull(last),
      iosImport,
      devices,
      databasePath,
    };
  });

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
        d.sync === "synced" && d.lastSync !== null
          ? `${d.name}: last synced ${yield* stamp(d.lastSync)}`
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
    if (s.lastActivity === null) {
      lines.push("last activity: none yet");
    } else {
      lines.push(`last activity: ${yield* stamp(s.lastActivity)}`);
    }
    lines.push(`database: ${s.databasePath}`);
    return lines;
  });
