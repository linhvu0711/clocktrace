import { homedir } from "node:os";

import {
  type Helper,
  type HelperExitedError,
  type HelperNotFoundError,
  type Launchd,
  type LaunchdError,
  type PermissionLine,
  readStatus,
  Status,
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

const permissionRow = (p: PermissionLine, look: Look): ReadonlyArray<Cell> => {
  const rest = p.name.startsWith("automation ")
    ? p.name.slice("automation ".length)
    : null;
  const label =
    rest !== null
      ? `Automation · ${rest}`
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
  if (p.state === "granted") {
    return [lead("ok"), span("dim", gives)];
  }
  if (p.state === "not checked") {
    return [lead("warn"), span("warn", p.note ?? "")];
  }
  return [
    lead("bad"),
    span("bad", `denied · turn it on in System Settings › Privacy › ${pane}`),
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
  const groups = columns(
    [
      [
        span("head", "Collector"),
        s.collector === "running"
          ? [mark("ok", look), " running"]
          : [mark("warn", look), " stopped · run clocktrace start"],
      ],
      [
        span("head", "Permissions"),
        span("dim", `${granted.length} of ${s.permissions.length} granted`),
      ],
      [
        span("head", "Last activity"),
        s.lastActivity === null ? "none yet" : clock(s.lastActivity, now),
      ],
      [span("head", "Database"), span("dim", shortPath(s.databasePath, home))],
    ],
    look,
  );
  return [
    groups[0] ?? "",
    groups[1] ?? "",
    ...columns(
      [...granted, ...rest].map((p) => permissionRow(p, look)),
      look,
    ),
    groups[2] ?? "",
    groups[3] ?? "",
  ];
};

export const printStatus = (
  json = false,
): Effect.Effect<
  void,
  | HelperNotFoundError
  | HelperExitedError
  | ParseError
  | StoreError
  | LaunchdError,
  Prompt | Launchd | Helper | Store | DateTime.CurrentTimeZone | Style
> =>
  Effect.gen(function* () {
    const status = yield* readStatus();
    const encoded = yield* Schema.encode(Status)(status);
    const look = yield* Style;
    const now = yield* DateTime.nowInCurrentZone;
    yield* report(json, encoded, () =>
      statusScreen(status, look, now, homedir()),
    );
  });

export const status = (
  json = false,
): Effect.Effect<
  void,
  | NotSetUpError
  | HelperNotFoundError
  | HelperExitedError
  | ParseError
  | StoreError
  | import("@clocktrace/core").DatabaseNewerError
  | LaunchdError,
  | Prompt
  | Launchd
  | Helper
  | FileSystem.FileSystem
  | DateTime.CurrentTimeZone
  | Style
> => requireSetUp.pipe(Effect.andThen(withStore(printStatus(json))));

export const statusCommand = Command.make(
  "status",
  { json: jsonOption },
  ({ json }) => status(json),
).pipe(Command.withDescription("show whether the collector is running"));
