import {
  type App,
  AppMissingError,
  browserName,
  CollectorPaths,
  checkAgain,
  type GrantItem,
  type GrantRequest,
  grantCount,
  grantPicture,
  grantRequest,
  Helper,
  type HelperExitedError,
  type Launchd,
  noAnswerNote,
  resetArgs,
  resetGrant,
  runCommand,
  stateOf,
} from "@clocktrace/collector";
import type { DatabaseNewerError, Store, StoreError } from "@clocktrace/core";
import { Command } from "@effect/cli";
import type {
  CommandExecutor,
  FileSystem,
  Path,
  Terminal,
} from "@effect/platform";
import { DateTime, Effect, Option } from "effect";
import type { ParseError } from "effect/ParseResult";

import {
  type Cell,
  clock,
  columns,
  line,
  mark,
  Style,
  span,
} from "./format.js";
import { Prompt, type Stdin, type StoppedError } from "./prompt.js";
import { type NotSetUpError, requireSetUp, withStore } from "./set-up.js";

const resetLater = (request: GrantRequest): string =>
  `later: tccutil ${resetArgs(request).join(" ")}, then run clocktrace permissions`;

const joinNames = (names: ReadonlyArray<string>): string =>
  names.length <= 2
    ? names.join(" and ")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;

const automationSettingsUrl =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation";

export const walkPermissions = (): Effect.Effect<
  void,
  AppMissingError | HelperExitedError | ParseError | StoppedError | StoreError,
  | Prompt
  | Stdin
  | Helper
  | App
  | CollectorPaths
  | Store
  | Terminal.Terminal
  | FileSystem.FileSystem
  | Path.Path
  | CommandExecutor.CommandExecutor
  | Style
  | DateTime.CurrentTimeZone
> =>
  Effect.gen(function* () {
    const prompt = yield* Prompt;
    const helper = yield* Helper;
    const { appPath } = yield* CollectorPaths;
    const look = yield* Style;
    // The Grant module's picture. The walk reads states from it and only
    // replaces it with what checkAgain or resetGrant gives back.
    let picture = yield* grantPicture();
    if (picture.app === "missing") {
      return yield* new AppMissingError({ path: appPath });
    }
    const interactive = yield* prompt.interactive;
    const items = picture.items;
    const now = yield* DateTime.nowInCurrentZone;
    const checked = (item: GrantItem): string =>
      item.checkedAt === null
        ? ""
        : ` · last checked ${clock(item.checkedAt, now)}`;
    const lead = (tone: "ok" | "warn" | "bad", item: GrantItem) => [
      "  ",
      mark(tone, look),
      " ",
      item.label,
    ];
    const givesWidth = Math.max(
      0,
      ...items.map((item) =>
        item.state === "notRunning" ||
        item.state === "noAnswer" ||
        (item.state === "notAsked" && item.kind === "automation")
          ? item.gives.length
          : 0,
      ),
    );
    const noteCell = (item: GrantItem, note: string): Cell => [
      span("dim", item.gives),
      " ".repeat(Math.max(2, givesWidth - item.gives.length + 2)),
      span("warn", note),
    ];
    const initialRow = (item: GrantItem): ReadonlyArray<Cell> => {
      const state = item.state;
      if (state === "granted") {
        return [lead("ok", item), span("dim", `${item.gives}${checked(item)}`)];
      }
      if (state === "noAnswer") {
        const browser =
          item.bundleId === null ? item.name : browserName(item.bundleId);
        return [lead("warn", item), noteCell(item, noAnswerNote(browser))];
      }
      if (state === "denied") {
        return [lead("bad", item), span("bad", `${item.fix}${checked(item)}`)];
      }
      return [lead("warn", item), noteCell(item, "not asked")];
    };
    // item is the first picture's: its words and checkedAt never change.
    const perms = items.flatMap((item) =>
      Option.match(grantRequest(item), {
        onNone: () => [],
        onSome: (request) => [{ item, request }],
      }),
    );
    type Perm = (typeof perms)[number];
    // The printed rows, one per perm, kept so the columns line up.
    const rows = perms.map((p) => initialRow(p.item));
    const printRow = (perm: Perm) =>
      prompt.print(columns(rows, look)[perms.indexOf(perm)] ?? "");
    const show = (perm: Perm, row: ReadonlyArray<Cell>) => {
      rows[perms.indexOf(perm)] = row;
      return printRow(perm);
    };
    const denied = (perm: Perm) => perm.item.state === "denied";
    yield* prompt.print(
      line(
        [span("head", "Permissions"), "   ", span("dim", grantCount(items))],
        look,
      ),
    );
    const listed = [
      ...perms.filter((p) => p.item.state === "granted"),
      ...perms.filter(
        (p) => p.item.state !== "granted" && (interactive ? !denied(p) : true),
      ),
    ];
    yield* Effect.forEach(listed, printRow);
    if (items.some((i) => i.state === "noBrowser")) {
      yield* prompt.print(
        line(
          [
            "  ",
            mark("warn", look),
            " Automation",
            span("warn", "  no browser used yet"),
          ],
          look,
        ),
      );
    }
    if (!interactive) {
      yield* prompt.print("no terminal, skipping questions");
      return;
    }
    // True when tccutil cleared the grant, so macOS can ask again.
    const offerReset = (perm: Perm, message: string) =>
      Effect.gen(function* () {
        const { item, request } = perm;
        const reset = yield* prompt.confirm({ message, initial: false });
        if (!reset) {
          yield* show(perm, [
            lead("warn", item),
            span("warn", resetLater(request)),
          ]);
          return false;
        }
        const after = yield* resetGrant(picture, request).pipe(
          Effect.map((next) => ({ next }) as const),
          Effect.catchTag("GrantResetError", (e) =>
            Effect.succeed({ error: e } as const),
          ),
        );
        if ("error" in after) {
          yield* show(perm, [
            lead("bad", item),
            span("bad", after.error.message),
          ]);
          return false;
        }
        picture = after.next;
        return true;
      });
    // True when macOS was asked and the grant is worth reading again.
    const requestGrant = (perm: Perm, afterReset: boolean) =>
      Effect.gen(function* () {
        const { item, request } = perm;
        const asked = yield* Effect.scoped(
          helper.request(appPath, request),
        ).pipe(
          Effect.map((outcome) => ({ outcome }) as const),
          Effect.catchTag("HelperExitedError", (e) =>
            Effect.succeed({ error: e } as const),
          ),
        );
        if ("error" in asked) {
          yield* show(perm, [
            lead("bad", item),
            span("bad", asked.error.message),
          ]);
          return false;
        }
        if (request.kind !== "automation") {
          yield* prompt.print(
            request.kind === "fullDiskAccess"
              ? afterReset
                ? "  → System Settings opened, add Clocktrace with + and turn it on"
                : "  → System Settings opened, turn it on for Clocktrace"
              : "  → macOS dialog opened, turn it on for Clocktrace",
          );
          const turnedOn = yield* prompt.confirm({
            message: "Turned on for Clocktrace?",
            initial: true,
          });
          if (!turnedOn) {
            yield* show(perm, [
              lead("warn", item),
              span(
                "warn",
                "later: turn it on, then run clocktrace permissions",
              ),
            ]);
            return false;
          }
        }
        return true;
      });
    const checkPerm = (perm: Perm) =>
      Effect.gen(function* () {
        picture = yield* checkAgain(picture, perm.request);
        return stateOf(picture, perm.request);
      });
    const printResult = (perm: Perm) => {
      const { item, request } = perm;
      const state = stateOf(picture, request);
      return show(
        perm,
        state === "granted"
          ? [lead("ok", item), span("dim", "granted")]
          : state === "noAnswer" && request.kind === "automation"
            ? [
                lead("warn", item),
                noteCell(item, noAnswerNote(browserName(request.bundleId))),
              ]
            : [lead("bad", item), span("bad", item.fix)],
      );
    };
    const ask = (perm: Perm) =>
      Effect.gen(function* () {
        const { item, request } = perm;
        if (request.kind === "automation") {
          if (stateOf(picture, request) !== "denied") {
            return;
          }
          const browser = browserName(request.bundleId);
          const open = yield* prompt.confirm({
            message: `${browser} is denied. Open System Settings to turn it on?`,
            initial: true,
          });
          if (!open) {
            yield* show(perm, initialRow(item));
            return;
          }
          const { code } = yield* runCommand("open", [automationSettingsUrl]);
          if (code !== 0) {
            yield* prompt.print(
              "  open System Settings › Privacy & Security › Automation › Clocktrace by hand",
            );
          }
          const switched = yield* prompt.confirm({
            message: "Switched on?",
            initial: true,
          });
          if (!switched) {
            yield* show(perm, [
              lead("warn", item),
              span(
                "warn",
                "later: switch it on, then run clocktrace permissions",
              ),
            ]);
            return;
          }
          if (item.checkedAt !== null) {
            yield* show(perm, initialRow(item));
            yield* prompt.print(
              `  ${browser} shows as granted the next time you open it`,
            );
            return;
          }
          const state = yield* checkPerm(perm);
          if (state === "notRunning") {
            yield* show(perm, initialRow(item));
            yield* prompt.print(
              `  ${browser} shows as granted the next time you open it`,
            );
            return;
          }
          if (state !== "denied") {
            yield* printResult(perm);
            return;
          }
          const names = perms.flatMap((p) =>
            p.request.kind === "automation"
              ? [browserName(p.request.bundleId)]
              : [],
          );
          const before = picture;
          if (
            !(yield* offerReset(
              perm,
              `Still denied. Reset the Automation Grants of ${joinNames(names)}? macOS asks each again the next time it comes to the front`,
            ))
          ) {
            return;
          }
          // The reset cleared every browser. Each one still denied before
          // it gets the reset row, and reads notAsked now, so it is not
          // asked again in this walk.
          for (const other of perms) {
            if (
              other.request.kind !== "automation" ||
              stateOf(before, other.request) !== "denied"
            ) {
              continue;
            }
            rows[perms.indexOf(other)] = [
              lead("warn", other.item),
              span(
                "warn",
                `reset · macOS asks the next time ${browserName(other.request.bundleId)} comes to the front`,
              ),
            ];
            if (other !== perm) {
              yield* printRow(other);
            }
          }
          yield* printRow(perm);
          return;
        }
        const allow = yield* prompt.confirm({
          message: `Allow ${item.label} (${item.gives})`,
          initial: true,
        });
        if (!allow) {
          yield* show(perm, [
            lead("warn", item),
            span("warn", "later: run clocktrace permissions"),
          ]);
          return;
        }
        if (!(yield* requestGrant(perm, false))) {
          return;
        }
        // Turned on yet still denied: the stored grant is stale.
        if ((yield* checkPerm(perm)) === "denied") {
          if (
            !(yield* offerReset(
              perm,
              "Still denied — reset the grant for Clocktrace?",
            ))
          ) {
            return;
          }
          if (!(yield* requestGrant(perm, true))) {
            return;
          }
          yield* checkPerm(perm);
        }
        yield* printResult(perm);
      });
    yield* Effect.forEach(perms.filter(denied), ask);
  });

export const permissions = (): Effect.Effect<
  void,
  | NotSetUpError
  | AppMissingError
  | HelperExitedError
  | ParseError
  | StoreError
  | DatabaseNewerError
  | StoppedError,
  | Prompt
  | Stdin
  | Helper
  | App
  | CollectorPaths
  | Launchd
  | FileSystem.FileSystem
  | Terminal.Terminal
  | Path.Path
  | CommandExecutor.CommandExecutor
  | DateTime.CurrentTimeZone
  | Style
> => requireSetUp.pipe(Effect.andThen(withStore(walkPermissions())));

export const permissionsCommand = Command.make("permissions", {}, () =>
  permissions(),
).pipe(
  Command.withDescription("check the macOS permissions the collector needs"),
);
