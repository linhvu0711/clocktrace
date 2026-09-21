import {
  type ActivitiesInput,
  ActivitiesPage,
  type Activity,
  activities,
  emptyNote,
  type InvalidRangeError,
  type Store,
  type StoreError,
  usedRange,
} from "@clocktrace/core";
import { Command, Options } from "@effect/cli";
import { DateTime, Effect, Option, Schema } from "effect";
import type { ParseError } from "effect/ParseResult";

import { jsonOption, report } from "./output.js";
import type { Prompt } from "./prompt.js";
import { whenSetUp } from "./set-up.js";
import {
  deviceOption,
  fromOption,
  localMinute,
  toOption,
  windowLine,
} from "./window.js";

export const activityLine = (a: Activity, zone: DateTime.TimeZone): string =>
  [
    localMinute(a.startedAt, zone),
    localMinute(a.endedAt, zone),
    a.appName,
    a.title ?? "-",
    a.url ?? "-",
  ].join("  ");

export const printActivities = (
  input: ActivitiesInput,
  json: boolean,
): Effect.Effect<
  void,
  InvalidRangeError | StoreError | ParseError,
  Store | Prompt | DateTime.CurrentTimeZone
> =>
  Effect.gen(function* () {
    const zone = yield* DateTime.CurrentTimeZone;
    const range = yield* usedRange(input.range);
    const page = yield* activities(input);
    const encoded = yield* Schema.encode(ActivitiesPage)(page);
    const lines = page.rows.map((a) => activityLine(a, zone));
    const value = { range, ...encoded, ...emptyNote(encoded.rows) };
    yield* report(json, value, (v) =>
      v.note === undefined
        ? [
            windowLine(v.range),
            ...lines,
            ...(v.hasMore
              ? [`${v.rows.length} of ${v.total}, use --limit`]
              : []),
          ]
        : [windowLine(v.range), v.note],
    );
  });

const appOption = Options.text("app").pipe(
  Options.optional,
  Options.withDescription("a bundle id or app name"),
);

const limitOption = Options.integer("limit").pipe(
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
    whenSetUp(
      printActivities(
        {
          range: { from, to },
          deviceId: Option.getOrUndefined(device),
          app: Option.getOrUndefined(app),
          limit: Option.getOrUndefined(limit),
        },
        json,
      ),
    ),
);
