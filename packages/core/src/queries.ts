import { type DateTime, Effect, Schema } from "effect";

import { Activity } from "./activity.js";
import type { AppStore } from "./app-store.js";
import type {
  InvalidInputError,
  InvalidRangeError,
  StoreError,
} from "./errors.js";
import { decodeInput } from "./input.js";
import { Range, UsedRange } from "./range.js";
import { loadRange } from "./range-rows.js";
import type { Store } from "./store.js";

const DeviceId = Schema.UUID.annotations({
  message: () => "must be a Device id",
});

const limitRule = { message: () => "must be a whole number above 0" };
const Limit = Schema.Number.pipe(
  Schema.int(limitRule),
  Schema.positive(limitRule),
);

export const ActivitiesInput = Schema.Struct({
  range: Range,
  device: Schema.optional(DeviceId),
  app: Schema.optional(Schema.String),
  limit: Schema.optional(Limit),
});

export const ActivitiesReply = Schema.Struct({
  range: UsedRange,
  rows: Schema.Array(Activity),
  total: Schema.Int,
  hasMore: Schema.Boolean,
  capped: Schema.optionalWith(Schema.Literal(true), { exact: true }),
  note: Schema.optionalWith(Schema.String, { exact: true }),
});

/** The note a reply carries when the window holds nothing. */
const emptyNote = (rows: ReadonlyArray<unknown>): { readonly note?: string } =>
  rows.length === 0 ? { note: "no activity in this range" } : {};

const deviceIdsOf = (
  device: string | undefined,
): ReadonlyArray<string> | undefined =>
  device === undefined ? undefined : [device];

export const activities = (
  input: Schema.Schema.Encoded<typeof ActivitiesInput>,
): Effect.Effect<
  ActivitiesReply,
  InvalidInputError | InvalidRangeError | StoreError,
  Store | AppStore | DateTime.CurrentTimeZone
> =>
  Effect.gen(function* () {
    const decoded = yield* decodeInput(ActivitiesInput)(input);
    const { range, rows } = yield* loadRange({
      range: decoded.range,
      deviceIds: deviceIdsOf(decoded.device),
    });
    const app = decoded.app?.toLowerCase();
    const filtered =
      app === undefined
        ? rows
        : rows.filter(
            (row) =>
              row.activity.bundleId.toLowerCase() === app ||
              row.activity.appName.toLowerCase() === app,
          );
    const page = filtered.slice(0, Math.min(decoded.limit ?? 200, 200));
    return {
      range,
      rows: page.map((row) => row.activity),
      total: filtered.length,
      hasMore: filtered.length > page.length,
      ...(decoded.limit !== undefined && decoded.limit > 200
        ? { capped: true as const }
        : {}),
      ...emptyNote(page),
    };
  });

export type ActivitiesInput = Schema.Schema.Type<typeof ActivitiesInput>;
export type ActivitiesReply = Schema.Schema.Type<typeof ActivitiesReply>;
