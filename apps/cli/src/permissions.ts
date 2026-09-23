import {
  App,
  AppMissingError,
  appBundleId,
  appPath,
  browserName,
  type GrantState,
  Helper,
  type HelperExitedError,
  type Launchd,
  noAnswerNote,
  type PermissionItem,
  permissionItems,
  readSavedGrants,
  savedGrantKey,
  saveLiveGrants,
  tccService,
} from "@clocktrace/collector";
import {
  type DatabaseNewerError,
  Store,
  type StoreError,
} from "@clocktrace/core";
import { Command } from "@effect/cli";
import type {
  CommandExecutor,
  FileSystem,
  Path,
  Terminal,
} from "@effect/platform";
import { DateTime, Effect } from "effect";
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
import { runCommand } from "./run-command.js";
import { type NotSetUpError, requireSetUp, withStore } from "./set-up.js";

const itemLabel = (item: PermissionItem): string =>
  item.request.kind === "automation"
    ? `Automation · ${browserName(item.request.bundleId)}`
    : item.request.kind === "fullDiskAccess"
      ? "Full Disk Access"
      : "Accessibility";

const itemPane = (item: PermissionItem): string =>
  item.request.kind === "automation" ? "Automation" : itemLabel(item);

const deniedFix = (item: PermissionItem): string =>
  `denied · turn it on in System Settings › Privacy › ${itemPane(item)}`;

// macOS asks once per grant. After a denial, or once an ad-hoc re-sign
// orphans the stored grant (ADR 0007), only a reset makes it ask again.
const resetArgs = (item: PermissionItem): ReadonlyArray<string> => [
  "reset",
  tccService(item.request),
  appBundleId,
];

const resetLater = (item: PermissionItem): string =>
  `later: tccutil ${resetArgs(item).join(" ")}, then run clocktrace permissions`;

const joinNames = (names: ReadonlyArray<string>): string =>
  names.length <= 2
    ? names.join(" and ")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;

const automationSettingsUrl =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation";

const askable = (_item: PermissionItem, state: GrantState): boolean =>
  state === "denied";

export const walkPermissions = (): Effect.Effect<
  void,
  AppMissingError | HelperExitedError | ParseError | StoppedError | StoreError,
  | Prompt
  | Stdin
  | Helper
  | App
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
    const app = yield* App;
    const store = yield* Store;
    const look = yield* Style;
    if (!(yield* app.isInstalled())) {
      yield* new AppMissingError({ path: appPath });
      return;
    }
    const interactive = yield* prompt.interactive;
    const p = yield* Effect.scoped(helper.permissions(appPath));
    yield* saveLiveGrants(p, yield* DateTime.now);
    const saved = yield* readSavedGrants();
    const items = permissionItems(p, saved);
    const now = yield* DateTime.nowInCurrentZone;
    const checked = (item: PermissionItem): string =>
      item.checkedAt === null
        ? ""
        : ` · last checked ${clock(item.checkedAt, now)}`;
    const lead = (tone: "ok" | "warn" | "bad", item: PermissionItem) => [
      "  ",
      mark(tone, look),
      " ",
      itemLabel(item),
    ];
    const givesWidth = Math.max(
      0,
      ...items.map((item) =>
        item.state === "notRunning" ||
        item.state === "noAnswer" ||
        (item.state === "notAsked" && item.request.kind === "automation")
          ? item.gives.length
          : 0,
      ),
    );
    const noteCell = (item: PermissionItem, note: string): Cell => [
      span("dim", item.gives),
      " ".repeat(Math.max(2, givesWidth - item.gives.length + 2)),
      span("warn", note),
    ];
    const initialRow = (item: PermissionItem): ReadonlyArray<Cell> => {
      const state = item.state;
      if (state === "granted") {
        return [lead("ok", item), span("dim", `${item.gives}${checked(item)}`)];
      }
      if (state === "noAnswer") {
        const browser =
          item.request.kind === "automation"
            ? browserName(item.request.bundleId)
            : item.name;
        return [lead("warn", item), noteCell(item, noAnswerNote(browser))];
      }
      if (state === "denied") {
        return [
          lead("bad", item),
          span("bad", `${deniedFix(item)}${checked(item)}`),
        ];
      }
      return [lead("warn", item), noteCell(item, "not asked")];
    };
    const perms = items.map((item) => ({
      item,
      state: item.state,
      row: initialRow(item),
    }));
    const printRow = (perm: (typeof perms)[number]) =>
      prompt.print(
        columns(
          perms.map((p) => p.row),
          look,
        )[perms.indexOf(perm)] ?? "",
      );
    const granted = perms.filter((p) => p.state === "granted");
    const hasAutomation = items.some((i) => i.request.kind === "automation");
    yield* prompt.print(
      line(
        [
          span("head", "Permissions"),
          "   ",
          span(
            "dim",
            `${granted.length} of ${perms.length + (hasAutomation ? 0 : 1)} granted`,
          ),
        ],
        look,
      ),
    );
    const listed = [
      ...perms.filter((p) => p.state === "granted"),
      ...perms.filter(
        (p) =>
          p.state !== "granted" &&
          (interactive ? !askable(p.item, p.state) : true),
      ),
    ];
    yield* Effect.forEach(listed, printRow);
    if (!hasAutomation) {
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
    type Perm = (typeof perms)[number];
    // True when tccutil cleared the grant, so macOS can ask again.
    const offerReset = (perm: Perm, message: string) =>
      Effect.gen(function* () {
        const { item } = perm;
        const reset = yield* prompt.confirm({ message, initial: false });
        if (!reset) {
          perm.row = [lead("warn", item), span("warn", resetLater(item))];
          yield* printRow(perm);
          return false;
        }
        const { code, output } = yield* runCommand("tccutil", resetArgs(item));
        if (code !== 0) {
          const error =
            output
              .split("\n")
              .map((l) => l.trim())
              .find((l) => l !== "") ?? `tccutil reset exited ${code}`;
          perm.row = [lead("bad", item), span("bad", error)];
          yield* printRow(perm);
          return false;
        }
        return true;
      });
    // True when macOS was asked and the grant is worth reading again.
    const requestGrant = (perm: Perm, afterReset: boolean) =>
      Effect.gen(function* () {
        const { item } = perm;
        const request = yield* Effect.scoped(
          helper.request(appPath, item.request),
        ).pipe(
          Effect.map((outcome) => ({ outcome }) as const),
          Effect.catchTag("HelperExitedError", (e) =>
            Effect.succeed({ error: e } as const),
          ),
        );
        if ("error" in request) {
          perm.row = [lead("bad", item), span("bad", request.error.message)];
          yield* printRow(perm);
          return false;
        }
        if (item.request.kind !== "automation") {
          yield* prompt.print(
            item.request.kind === "fullDiskAccess"
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
            perm.row = [
              lead("warn", item),
              span(
                "warn",
                "later: turn it on, then run clocktrace permissions",
              ),
            ];
            yield* printRow(perm);
            return false;
          }
        }
        return true;
      });
    const recheck = (perm: Perm) =>
      Effect.gen(function* () {
        const { item } = perm;
        const after = yield* Effect.scoped(helper.permissions(appPath));
        yield* saveLiveGrants(after, yield* DateTime.now);
        perm.state =
          item.request.kind === "automation"
            ? (after.automation[item.request.bundleId] ?? perm.state)
            : item.request.kind === "fullDiskAccess"
              ? after.fullDiskAccess
              : after.accessibility;
      });
    const printResult = (perm: Perm) => {
      const { item } = perm;
      perm.row =
        perm.state === "granted"
          ? [lead("ok", item), span("dim", "granted")]
          : perm.state === "noAnswer" && item.request.kind === "automation"
            ? [
                lead("warn", item),
                noteCell(
                  item,
                  noAnswerNote(browserName(item.request.bundleId)),
                ),
              ]
            : [lead("bad", item), span("bad", deniedFix(item))];
      return printRow(perm);
    };
    const ask = (perm: Perm) =>
      Effect.gen(function* () {
        const { item } = perm;
        if (item.request.kind === "automation") {
          if (perm.state !== "denied") {
            return;
          }
          const browser = browserName(item.request.bundleId);
          const open = yield* prompt.confirm({
            message: `${browser} is denied. Open System Settings to turn it on?`,
            initial: true,
          });
          if (!open) {
            perm.row = initialRow(item);
            yield* printRow(perm);
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
            perm.row = [
              lead("warn", item),
              span(
                "warn",
                "later: switch it on, then run clocktrace permissions",
              ),
            ];
            yield* printRow(perm);
            return;
          }
          if (item.checkedAt !== null) {
            perm.row = initialRow(item);
            yield* printRow(perm);
            yield* prompt.print(
              `  ${browser} shows as granted the next time you open it`,
            );
            return;
          }
          yield* recheck(perm);
          if (perm.state !== "denied") {
            yield* printResult(perm);
            return;
          }
          const names = perms.flatMap((p) =>
            p.item.request.kind === "automation"
              ? [browserName(p.item.request.bundleId)]
              : [],
          );
          if (
            !(yield* offerReset(
              perm,
              `Still denied. Reset the Automation Grants of ${joinNames(names)}? macOS asks each again the next time it comes to the front`,
            ))
          ) {
            return;
          }
          for (const other of perms) {
            if (other.item.request.kind !== "automation") {
              continue;
            }
            yield* store.deleteSetting(
              savedGrantKey(other.item.request.bundleId),
            );
            // The reset cleared every browser's grant, so a sibling still
            // queued as denied is already back to notAsked — it must not be
            // asked again in this walk.
            if (other.state === "denied") {
              other.state = "notAsked";
              other.row = [
                lead("warn", other.item),
                span(
                  "warn",
                  `reset · macOS asks the next time ${browserName(other.item.request.bundleId)} comes to the front`,
                ),
              ];
              if (other !== perm) {
                yield* printRow(other);
              }
            }
          }
          yield* printRow(perm);
          return;
        }
        const allow = yield* prompt.confirm({
          message: `Allow ${itemLabel(item)} (${item.gives})`,
          initial: true,
        });
        if (!allow) {
          perm.row = [
            lead("warn", item),
            span("warn", "later: run clocktrace permissions"),
          ];
          yield* printRow(perm);
          return;
        }
        if (!(yield* requestGrant(perm, false))) {
          return;
        }
        yield* recheck(perm);
        // Turned on yet still denied: the stored grant is stale.
        if (perm.state === "denied") {
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
          yield* recheck(perm);
        }
        yield* printResult(perm);
      });
    yield* Effect.forEach(
      perms.filter((p) => askable(p.item, p.state)),
      ask,
    );
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
