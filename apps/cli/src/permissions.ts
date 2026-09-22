import {
  App,
  AppMissingError,
  appPath,
  browserName,
  type GrantState,
  Helper,
  type HelperExitedError,
  type Launchd,
  noAnswerNote,
  type PermissionItem,
  permissionItems,
} from "@clocktrace/collector";
import type { DatabaseNewerError, StoreError } from "@clocktrace/core";
import { Command } from "@effect/cli";
import {
  type CommandExecutor,
  type FileSystem,
  type Path,
  Command as PlatformCommand,
  type Terminal,
} from "@effect/platform";
import { Data, Effect, Either, Schedule } from "effect";
import type { ParseError } from "effect/ParseResult";

import { type Cell, columns, line, mark, Style, span } from "./format.js";
import { Prompt, type Stdin, type StoppedError } from "./prompt.js";
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

class BrowserNotRunning extends Data.TaggedError("BrowserNotRunning")<{
  readonly bundleId: string;
}> {}

const defaultOpenRetry = Schedule.recurs(20).pipe(
  Schedule.addDelay(() => "500 millis"),
);

const joinNames = (names: ReadonlyArray<string>): string =>
  names.length <= 2
    ? names.join(" and ")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;

const askable = (item: PermissionItem, state: GrantState): boolean =>
  item.request.kind === "automation"
    ? state === "notAsked"
    : state === "denied";

export const walkPermissions = (
  options: {
    readonly openRetry?: Schedule.Schedule<unknown, unknown> | undefined;
  } = {},
): Effect.Effect<
  void,
  AppMissingError | HelperExitedError | ParseError | StoppedError,
  | Prompt
  | Stdin
  | Helper
  | App
  | Terminal.Terminal
  | FileSystem.FileSystem
  | Path.Path
  | CommandExecutor.CommandExecutor
  | Style
> =>
  Effect.gen(function* () {
    const prompt = yield* Prompt;
    const helper = yield* Helper;
    const app = yield* App;
    const look = yield* Style;
    if (!(yield* app.isInstalled())) {
      yield* new AppMissingError({ path: appPath });
      return;
    }
    const interactive = yield* prompt.interactive;
    const p = yield* Effect.scoped(helper.permissions(appPath));
    const items = permissionItems(p);
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
        return [lead("ok", item), span("dim", item.gives)];
      }
      if (state === "notRunning") {
        const browser =
          item.request.kind === "automation"
            ? browserName(item.request.bundleId)
            : item.name;
        return [lead("warn", item), noteCell(item, `${browser} is closed`)];
      }
      if (state === "noAnswer") {
        const browser =
          item.request.kind === "automation"
            ? browserName(item.request.bundleId)
            : item.name;
        return [lead("warn", item), noteCell(item, noAnswerNote(browser))];
      }
      if (state === "denied") {
        return [lead("bad", item), span("bad", deniedFix(item))];
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
    yield* prompt.print(
      line(
        [
          span("head", "Permissions"),
          "   ",
          span("dim", `${granted.length} of ${perms.length} granted`),
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
    if (!interactive) {
      yield* prompt.print("no terminal, skipping questions");
      return;
    }
    const openRetry = options.openRetry ?? defaultOpenRetry;
    const closed = perms.filter(
      (p) => p.state === "notRunning" && p.item.request.kind === "automation",
    );
    if (closed.length > 0) {
      const openThem = yield* prompt.confirm({
        message: `Open ${joinNames(
          closed.map((p) =>
            p.item.request.kind === "automation"
              ? browserName(p.item.request.bundleId)
              : p.item.name,
          ),
        )} now and ask?`,
        initial: false,
      });
      if (!openThem) {
        yield* prompt.print(
          "  later: open the browser, then run clocktrace permissions",
        );
      } else {
        yield* Effect.forEach(closed, (perm) =>
          Effect.gen(function* () {
            const { item } = perm;
            if (item.request.kind !== "automation") {
              return;
            }
            const bundleId = item.request.bundleId;
            const code = yield* PlatformCommand.exitCode(
              PlatformCommand.make("open", "-b", bundleId),
            ).pipe(Effect.orElseSucceed(() => 1));
            const opened =
              code === 0
                ? yield* Effect.scoped(helper.permissions(appPath)).pipe(
                    Effect.flatMap((after) =>
                      after.automation[bundleId] === undefined ||
                      after.automation[bundleId] === "notRunning"
                        ? Effect.fail(new BrowserNotRunning({ bundleId }))
                        : Effect.succeed(
                            after.automation[bundleId] as GrantState,
                          ),
                    ),
                    Effect.retry({
                      schedule: openRetry,
                      while: (e) => e._tag === "BrowserNotRunning",
                    }),
                    Effect.either,
                  )
                : Either.left(new BrowserNotRunning({ bundleId }));
            if (Either.isLeft(opened)) {
              const e = opened.left;
              perm.row =
                e._tag === "BrowserNotRunning"
                  ? [
                      lead("warn", item),
                      span(
                        "warn",
                        `${browserName(bundleId)} did not open · open it, then run clocktrace permissions`,
                      ),
                    ]
                  : [lead("bad", item), span("bad", e.message)];
              yield* printRow(perm);
              return;
            }
            perm.state = opened.right;
          }),
        );
      }
    }
    yield* Effect.forEach(
      perms.filter((p) => askable(p.item, p.state)),
      (perm) =>
        Effect.gen(function* () {
          const { item } = perm;
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
            return;
          }
          if (
            request.outcome === "notRunning" &&
            item.request.kind === "automation"
          ) {
            perm.state = "notRunning";
            perm.row = [
              lead("warn", item),
              noteCell(item, `${browserName(item.request.bundleId)} is closed`),
            ];
            yield* printRow(perm);
            return;
          }
          if (item.request.kind !== "automation") {
            yield* prompt.print(
              item.request.kind === "fullDiskAccess"
                ? "  → System Settings opened, turn it on for Clocktrace"
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
              return;
            }
          }
          const after = yield* Effect.scoped(helper.permissions(appPath));
          perm.state =
            item.request.kind === "automation"
              ? (after.automation[item.request.bundleId] ?? perm.state)
              : item.request.kind === "fullDiskAccess"
                ? after.fullDiskAccess
                : after.accessibility;
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
          yield* printRow(perm);
        }),
    );
  });

export const permissions = (
  openRetry?: Schedule.Schedule<unknown, unknown>,
): Effect.Effect<
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
  | Style
> =>
  requireSetUp.pipe(Effect.andThen(withStore(walkPermissions({ openRetry }))));

export const permissionsCommand = Command.make("permissions", {}, () =>
  permissions(),
).pipe(
  Command.withDescription("check the macOS permissions the collector needs"),
);
