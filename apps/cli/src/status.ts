import { homedir } from "node:os";

import {
  type App,
  type DeviceStatus,
  type Helper,
  type HelperExitedError,
  type Launchd,
  type LaunchdError,
  type PermissionLine,
  readStatus,
  Status,
  statusLines,
} from "@clocktrace/collector";
import type { Store, StoreError } from "@clocktrace/core";
import { Command } from "@effect/cli";
import type { FileSystem } from "@effect/platform";
import { DateTime, Effect, Schema } from "effect";
import type { ParseError } from "effect/ParseResult";

import {
  type Cell,
  clock,
  columns,
  type Look,
  mark,
  Style,
  shortPath,
  span,
} from "./format.js";
import { jsonOption, report } from "./output.js";
import type { Prompt } from "./prompt.js";
import { type NotSetUpError, requireSetUp, withStore } from "./set-up.js";

const permissionRow = (
  p: PermissionLine,
  look: Look,
  now: DateTime.Zoned,
): ReadonlyArray<Cell> => {
  const rest = p.name.startsWith("automation ")
    ? p.name.slice("automation ".length)
    : null;
  const label =
    rest !== null
      ? `Automation · ${rest}`
      : p.name === "automation"
        ? "Automation"
        : p.name === "full disk access"
          ? "Full Disk Access"
          : "Accessibility";
  const gives =
    rest !== null
      ? `URLs in ${rest}`
      : p.name === "full disk access"
        ? "iPhone and iPad import"
        : "window titles";
  const pane = rest !== null ? "Automation" : label;
  const lead = (tone: "ok" | "warn" | "bad") => [
    "  ",
    mark(tone, look),
    " ",
    label,
  ];
  const checked =
    p.checkedAt === null ? "" : ` · last checked ${clock(p.checkedAt, now)}`;
  if (p.state === "granted") {
    return [lead("ok"), span("dim", `${gives}${checked}`)];
  }
  if (p.state === "not checked") {
    return [lead("warn"), span("warn", p.note ?? "")];
  }
  return [
    lead("bad"),
    span(
      "bad",
      `denied · turn it on in System Settings › Privacy › ${pane}${checked}`,
    ),
  ];
};

const deviceRow = (
  d: DeviceStatus,
  look: Look,
  now: DateTime.Zoned,
): ReadonlyArray<Cell> => {
  const tone = d.sync === "synced" ? "ok" : d.sync === "stale" ? "bad" : "warn";
  const sync =
    d.sync === "synced" && d.lastSync !== null
      ? `last synced ${clock(d.lastSync, now)}`
      : d.sync === "stale" && d.lastSync !== null
        ? `not syncing since ${clock(d.lastSync, now)}`
        : "never synced";
  const activity =
    d.lastActivity === null ? "none yet" : clock(d.lastActivity, now);
  return [
    ["  ", mark(tone, look), " ", d.name],
    span(tone === "ok" ? "dim" : tone, `${sync} · last activity ${activity}`),
  ];
};

const statusScreen = (
  s: Status,
  look: Look,
  now: DateTime.Zoned,
  home: string,
): ReadonlyArray<string> => {
  const granted = s.permissions.filter((p) => p.state === "granted");
  const rest = s.permissions.filter((p) => p.state !== "granted");
  const collector: ReadonlyArray<Cell> = [
    span("head", "Collector"),
    s.collector === "running"
      ? [mark("ok", look), " running"]
      : [mark("warn", look), " stopped · run clocktrace start"],
  ];
  const permissions: ReadonlyArray<Cell> = [
    span("head", "Permissions"),
    span("dim", `${granted.length} of ${s.permissions.length} granted`),
  ];
  const ios: ReadonlyArray<Cell> | null =
    s.iosImport === null
      ? null
      : [
          span("head", "iOS import"),
          s.iosImport.state === "ok"
            ? [mark("ok", look), ` ok · ${clock(s.iosImport.at, now)}`]
            : s.iosImport.state === "broken"
              ? [mark("bad", look), ` broken · ${s.iosImport.reason}`]
              : [
                  mark("warn", look),
                  ` not tested on macOS ${s.iosImport.macosVersion}`,
                ],
        ];
  const last: ReadonlyArray<Cell> = [
    span("head", "Last activity"),
    s.lastActivity === null ? "none yet" : clock(s.lastActivity, now),
  ];
  const database: ReadonlyArray<Cell> = [
    span("head", "Database"),
    span("dim", shortPath(s.databasePath, home)),
  ];
  const groupRows = columns(
    [collector, permissions, ...(ios !== null ? [ios] : []), last, database],
    look,
  );
  const [g0, g1, gIos, gLast, gDb] =
    ios !== null
      ? [groupRows[0], groupRows[1], groupRows[2], groupRows[3], groupRows[4]]
      : [groupRows[0], groupRows[1], undefined, groupRows[2], groupRows[3]];
  return [
    g0 ?? "",
    g1 ?? "",
    ...columns(
      [...granted, ...rest].map((p) => permissionRow(p, look, now)),
      look,
    ),
    ...(ios !== null
      ? [
          gIos ?? "",
          ...columns(
            s.devices.map((d) => deviceRow(d, look, now)),
            look,
          ),
        ]
      : []),
    gLast ?? "",
    gDb ?? "",
  ];
};

export const printStatus = (
  json = false,
): Effect.Effect<
  void,
  HelperExitedError | ParseError | StoreError | LaunchdError,
  Prompt | Launchd | Helper | App | Store | DateTime.CurrentTimeZone | Style
> =>
  Effect.gen(function* () {
    const status = yield* readStatus();
    const encoded = yield* Schema.encode(Status)(status);
    const look = yield* Style;
    const now = yield* DateTime.nowInCurrentZone;
    const lines =
      status.app === "missing"
        ? yield* statusLines(status)
        : statusScreen(status, look, now, homedir());
    yield* report(json, encoded, () => lines);
  });

export const status = (
  json = false,
): Effect.Effect<
  void,
  | NotSetUpError
  | HelperExitedError
  | ParseError
  | StoreError
  | import("@clocktrace/core").DatabaseNewerError
  | LaunchdError,
  | Prompt
  | Launchd
  | Helper
  | App
  | FileSystem.FileSystem
  | DateTime.CurrentTimeZone
  | Style
> => requireSetUp.pipe(Effect.andThen(withStore(printStatus(json))));

export const statusCommand = Command.make(
  "status",
  { json: jsonOption },
  ({ json }) => status(json),
).pipe(Command.withDescription("show whether the collector is running"));
