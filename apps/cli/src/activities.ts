import {
  type ActivitiesInput,
  ActivitiesReply,
  type Activity,
  type AppStore,
  activities,
  type InvalidInputError,
  type InvalidRangeError,
  type Store,
  type StoreError,
} from "@clocktrace/core";
import { Command, Options } from "@effect/cli";
import { DateTime, Effect, Option, Schema } from "effect";
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
  input: Schema.Schema.Encoded<typeof ActivitiesInput>,
  json: boolean,
): Effect.Effect<
  void,
  InvalidInputError | InvalidRangeError | StoreError | ParseError,
  Store | AppStore | Prompt | DateTime.CurrentTimeZone | Style
> =>
  Effect.gen(function* () {
    const look = yield* Style;
    const zone = yield* DateTime.CurrentTimeZone;
    const reply = yield* activities(input);
    const encoded = yield* Schema.encode(ActivitiesReply)(reply);
    const lines = activitiesScreen(reply.rows, zone, look);
    yield* report(json, encoded, (v) =>
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
            ...(v.capped === true
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

// --limit is read as text and sent to core as Number(text), so core words
// every bad value, "abc" (NaN) included, the same as for the MCP tool.
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
      const range = yield* requireWindow("activities", from, to);
      return yield* whenSetUp(
        printActivities(
          {
            range,
            device: Option.getOrUndefined(device),
            app: Option.getOrUndefined(app),
            limit: Option.getOrUndefined(Option.map(limit, Number)),
          },
          json,
        ),
      );
    }),
).pipe(Command.withDescription("list raw activities"));
