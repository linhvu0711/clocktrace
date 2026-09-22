import {
  type ActivitiesInput,
  ActivitiesPage,
  type Activity,
  type AppStore,
  activities,
  emptyNote,
  type InvalidRangeError,
  type Store,
  type StoreError,
  usedRange,
} from "@clocktrace/core";
import { Command, Options } from "@effect/cli";
import { Data, DateTime, Effect, Option, Schema } from "effect";
import type { ParseError } from "effect/ParseResult";

import {
  type Cell,
  columns,
  type Look,
  line,
  Style,
  shortDuration,
  span,
} from "./format.js";
import { jsonOption, report } from "./output.js";
import type { Prompt } from "./prompt.js";
import { whenSetUp } from "./set-up.js";
import {
  deviceOption,
  fromOption,
  localMinute,
  requireWindow,
  toOption,
  windowLine,
} from "./window.js";

// biome-ignore lint/complexity/noBannedTypes: the error has no fields
export class BadLimitError extends Data.TaggedError("BadLimitError")<{}> {}

// --limit is parsed as text so we own the error wording instead of the
// library's "'x' is not a integer". Only a positive whole number is valid:
// Number("") and Number("  ") are 0, so an empty flag would otherwise slip
// through as a zero-row page. This matches the MCP tool's z.number().int()
// .positive().
export const parseLimit = (
  limit: Option.Option<string>,
): Effect.Effect<Option.Option<number>, BadLimitError> =>
  Option.match(limit, {
    onNone: () => Effect.succeed(Option.none()),
    onSome: (text) => {
      const n = Number(text);
      return Number.isInteger(n) && n > 0
        ? Effect.succeed(Option.some(n))
        : Effect.fail(new BadLimitError());
    },
  });

export const activitiesScreen = (
  rows: ReadonlyArray<Activity>,
  zone: DateTime.TimeZone,
  look: Look,
): ReadonlyArray<string> => {
  const secondsOf = (a: Activity) =>
    Math.round((a.endedAt.epochMillis - a.startedAt.epochMillis) / 1000);
  const widest = Math.max(
    ...rows.map((a) => shortDuration(secondsOf(a)).length),
  );
  return columns(
    rows.map(
      (a): ReadonlyArray<Cell> => [
        `  ${localMinute(a.startedAt, zone).slice(11)}`,
        shortDuration(secondsOf(a)).padStart(widest),
        a.appName,
        a.title ?? span("dim", "—"),
        a.url ?? span("dim", "—"),
      ],
    ),
    look,
  );
};

export const printActivities = (
  input: ActivitiesInput,
  json: boolean,
): Effect.Effect<
  void,
  InvalidRangeError | StoreError | ParseError,
  Store | AppStore | Prompt | DateTime.CurrentTimeZone | Style
> =>
  Effect.gen(function* () {
    const look = yield* Style;
    const zone = yield* DateTime.CurrentTimeZone;
    const range = yield* usedRange(input.range);
    const page = yield* activities(input);
    const encoded = yield* Schema.encode(ActivitiesPage)(page);
    const lines = activitiesScreen(page.rows, zone, look);
    const value = { range, ...encoded, ...emptyNote(encoded.rows) };
    yield* report(json, value, (v) =>
      v.note === undefined
        ? [
            windowLine(input.range, v.range.zone, look),
            ...lines,
            ...(v.hasMore
              ? [
                  line(
                    [
                      "  ",
                      span(
                        "dim",
                        `showing ${v.rows.length} of ${v.total} · raise --limit (max 200), narrow the range, or add --app`,
                      ),
                    ],
                    look,
                  ),
                ]
              : []),
            ...(input.limit !== undefined && input.limit > 200
              ? [line(["  ", span("dim", "--limit capped at 200")], look)]
              : []),
          ]
        : [windowLine(input.range, v.range.zone, look), "no activity"],
    );
  });

const appOption = Options.text("app").pipe(
  Options.optional,
  Options.withDescription("a bundle id or app name"),
);

const limitOption = Options.text("limit").pipe(
  Options.optional,
  Options.withDescription("rows to print, at most 200"),
);

export const activitiesCommand = Command.make(
  "activities",
  {
    from: fromOption,
    to: toOption,
    device: deviceOption,
    app: appOption,
    limit: limitOption,
    json: jsonOption,
  },
  ({ from, to, device, app, limit, json }) =>
    Effect.gen(function* () {
      const rows = yield* parseLimit(limit);
      const range = yield* requireWindow("activities", from, to);
      return yield* whenSetUp(
        printActivities(
          {
            range,
            deviceId: Option.getOrUndefined(device),
            app: Option.getOrUndefined(app),
            limit: Option.getOrUndefined(rows),
          },
          json,
        ),
      );
    }),
).pipe(Command.withDescription("list raw activities"));
