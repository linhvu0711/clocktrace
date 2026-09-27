import { DateTime, Effect, Schema } from "effect";

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

export const GroupBy = Schema.Literal("category", "project", "app", "device");

const DeviceId = Schema.UUID.annotations({
  message: () => "must be a Device id",
});

export const SummaryRow = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
  seconds: Schema.Int,
  productive: Schema.optional(Schema.Boolean),
});

export const SummaryReply = Schema.Struct({
  range: UsedRange,
  rows: Schema.Array(SummaryRow),
  total: Schema.Int,
  note: Schema.optionalWith(Schema.String, { exact: true }),
});

export const SummaryInput = Schema.Struct({
  range: Range,
  groupBy: GroupBy,
  device: Schema.optional(DeviceId),
});

export const TimelineBlock = Schema.Struct({
  start: Schema.DateTimeUtc,
  end: Schema.DateTimeUtc,
  app: Schema.String,
  categoryName: Schema.String,
  projectName: Schema.NullOr(Schema.String),
});

export const TimelineInput = Schema.Struct({
  range: Range,
  device: Schema.optional(DeviceId),
});

export const TimelineReply = Schema.Struct({
  range: UsedRange,
  rows: Schema.Array(TimelineBlock),
  total: Schema.Int,
  note: Schema.optionalWith(Schema.String, { exact: true }),
});

// Both rules carry the message, or NaN and 1.5 would get Effect's own words.
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

export const summary = (
  input: Schema.Schema.Encoded<typeof SummaryInput>,
): Effect.Effect<
  SummaryReply,
  InvalidInputError | InvalidRangeError | StoreError,
  Store | AppStore | DateTime.CurrentTimeZone
> =>
  Effect.gen(function* () {
    const decoded = yield* decodeInput(SummaryInput)(input);
    const { range, rows, categories, projects, devices } = yield* loadRange({
      range: decoded.range,
      deviceIds: deviceIdsOf(decoded.device),
    });
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const deviceById = new Map(devices.map((d) => [d.id, d]));
    const groups = new Map<string, { row: SummaryRow; ms: number }>();
    for (const { activity, resolution, ms } of rows) {
      let row: SummaryRow;
      switch (decoded.groupBy) {
        case "category": {
          const category =
            resolution.categoryId === null
              ? undefined
              : categoryById.get(resolution.categoryId);
          row =
            category === undefined
              ? { key: "uncategorized", name: "Uncategorized", seconds: 0 }
              : {
                  key: category.id,
                  name: category.name,
                  seconds: 0,
                  productive: category.productive,
                };
          break;
        }
        case "project": {
          const project =
            resolution.projectId === null
              ? undefined
              : projectById.get(resolution.projectId);
          row =
            project === undefined
              ? { key: "no-project", name: "No project", seconds: 0 }
              : { key: project.id, name: project.name, seconds: 0 };
          break;
        }
        case "app":
          row = {
            key: activity.bundleId,
            name: activity.appName,
            seconds: 0,
          };
          break;
        case "device": {
          const device = deviceById.get(activity.deviceId);
          row = {
            key: activity.deviceId,
            name: device?.name ?? activity.deviceId,
            seconds: 0,
          };
          break;
        }
      }
      const existing = groups.get(row.key);
      groups.set(row.key, {
        row: existing?.row ?? row,
        ms: (existing?.ms ?? 0) + ms,
      });
    }
    // Each group rounds once, so two 500 ms rows count as one second.
    const sorted = [...groups.values()]
      .map(({ row, ms }) => ({ ...row, seconds: Math.round(ms / 1000) }))
      .sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name));
    return {
      range,
      rows: sorted,
      total: sorted.reduce((sum, row) => sum + row.seconds, 0),
      ...emptyNote(sorted),
    };
  });

export const timeline = (
  input: Schema.Schema.Encoded<typeof TimelineInput>,
): Effect.Effect<
  TimelineReply,
  InvalidInputError | InvalidRangeError | StoreError,
  Store | AppStore | DateTime.CurrentTimeZone
> =>
  Effect.gen(function* () {
    const decoded = yield* decodeInput(TimelineInput)(input);
    const { range, rows, categories, projects, from, to } = yield* loadRange({
      range: decoded.range,
      deviceIds: deviceIdsOf(decoded.device),
    });
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const projectById = new Map(projects.map((p) => [p.id, p]));
    interface Block {
      startMs: number;
      endMs: number;
      deviceId: string;
      bundleId: string;
      categoryId: string | null;
      projectId: string | null;
      app: string;
      categoryName: string;
      projectName: string | null;
    }
    const blocks: Array<Block> = [];
    for (const { activity, resolution } of rows) {
      const startMs = Math.max(
        activity.startedAt.epochMillis,
        from.epochMillis,
      );
      const endMs = Math.min(activity.endedAt.epochMillis, to.epochMillis);
      const category =
        resolution.categoryId === null
          ? null
          : (categoryById.get(resolution.categoryId) ?? null);
      const project =
        resolution.projectId === null
          ? null
          : (projectById.get(resolution.projectId) ?? null);
      const last = blocks[blocks.length - 1];
      if (
        last !== undefined &&
        last.deviceId === activity.deviceId &&
        last.bundleId === activity.bundleId &&
        last.categoryId === (category?.id ?? null) &&
        last.projectId === (project?.id ?? null) &&
        activity.startedAt.epochMillis - last.endMs <= 60_000
      ) {
        last.endMs = Math.max(last.endMs, endMs);
      } else {
        blocks.push({
          startMs,
          endMs,
          deviceId: activity.deviceId,
          bundleId: activity.bundleId,
          categoryId: category?.id ?? null,
          projectId: project?.id ?? null,
          app: activity.appName,
          categoryName: category?.name ?? "Uncategorized",
          projectName: project?.name ?? null,
        });
      }
    }
    const timelineRows = blocks.map((block) => ({
      start: DateTime.unsafeMake(block.startMs),
      end: DateTime.unsafeMake(block.endMs),
      app: block.app,
      categoryName: block.categoryName,
      projectName: block.projectName,
    }));
    return {
      range,
      rows: timelineRows,
      total: timelineRows.length,
      ...emptyNote(timelineRows),
    };
  });

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

export type GroupBy = Schema.Schema.Type<typeof GroupBy>;
export type SummaryRow = Schema.Schema.Type<typeof SummaryRow>;
export type SummaryReply = Schema.Schema.Type<typeof SummaryReply>;
export type SummaryInput = Schema.Schema.Type<typeof SummaryInput>;
export type TimelineBlock = Schema.Schema.Type<typeof TimelineBlock>;
export type TimelineInput = Schema.Schema.Type<typeof TimelineInput>;
export type TimelineReply = Schema.Schema.Type<typeof TimelineReply>;
export type ActivitiesInput = Schema.Schema.Type<typeof ActivitiesInput>;
export type ActivitiesReply = Schema.Schema.Type<typeof ActivitiesReply>;
