import { Store, type StoreError } from "@clocktrace/core";
import { DateTime, Effect, Option, Schema } from "effect";
import type { ParseError } from "effect/ParseResult";
import { dbPathConfig, helperPathConfig } from "./config.js";
import {
  Helper,
  type HelperExitedError,
  type HelperNotFoundError,
} from "./helper.js";
import { Launchd, type LaunchdError } from "./launchd.js";
import {
  browserName,
  type PermissionItem,
  permissionItems,
} from "./permissions.js";

export const PermissionLine = Schema.Struct({
  name: Schema.String,
  state: Schema.Literal("granted", "denied", "not checked"),
  note: Schema.NullOr(Schema.String),
});

export type PermissionLine = Schema.Schema.Type<typeof PermissionLine>;

export const Status = Schema.Struct({
  collector: Schema.Literal("running", "stopped"),
  permissions: Schema.Array(PermissionLine),
  lastActivity: Schema.NullOr(Schema.DateTimeUtc),
  databasePath: Schema.String,
});

export type Status = Schema.Schema.Type<typeof Status>;

export const permissionLine = (item: PermissionItem): PermissionLine => {
  if (item.state === "granted") {
    return { name: item.name, state: "granted", note: null };
  }
  if (item.state === "notRunning") {
    const browser =
      item.request.kind === "automation"
        ? browserName(item.request.bundleId)
        : item.name;
    return {
      name: item.name,
      state: "not checked",
      note: `${browser} is not running`,
    };
  }
  return { name: item.name, state: "denied", note: item.loss };
};

export const readStatus = (): Effect.Effect<
  Status,
  | HelperNotFoundError
  | HelperExitedError
  | ParseError
  | StoreError
  | LaunchdError,
  Store | Launchd | Helper
> =>
  Effect.gen(function* () {
    const helperPath = yield* Effect.orDie(helperPathConfig);
    const helper = yield* Helper;
    yield* helper.check(helperPath);
    const p = yield* helper.permissions(helperPath);
    const launchd = yield* Launchd;
    const collector = yield* launchd.state();
    const store = yield* Store;
    const last = yield* store.latestActivityEnd();
    const databasePath = yield* Effect.orDie(dbPathConfig);
    return {
      collector,
      permissions: permissionItems(p).map(permissionLine),
      lastActivity: Option.getOrNull(last),
      databasePath,
    };
  });

const pad = (n: number): string => String(n).padStart(2, "0");

export const statusLines = (
  s: Status,
): Effect.Effect<ReadonlyArray<string>, never, DateTime.CurrentTimeZone> =>
  Effect.gen(function* () {
    const lines = [
      s.collector === "running"
        ? "collector: running"
        : "collector: stopped, run clocktrace start",
      ...s.permissions.map(
        (p) => `${p.name}: ${p.state}${p.note === null ? "" : `, ${p.note}`}`,
      ),
    ];
    if (s.lastActivity === null) {
      lines.push("last activity: none yet");
    } else {
      const parts = DateTime.toParts(
        yield* DateTime.setZoneCurrent(s.lastActivity),
      );
      lines.push(
        `last activity: ${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hours)}:${pad(parts.minutes)}`,
      );
    }
    lines.push(`database: ${s.databasePath}`);
    return lines;
  });
