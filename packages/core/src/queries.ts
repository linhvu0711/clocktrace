import {
  DateTime,
  Effect,
  Either,
  Option,
  ParseResult,
  Ref,
  Schema,
} from "effect";

import { Activity } from "./activity.js";
import {
  classifyAppName,
  lookupAndCache,
  type ResolvedApp,
} from "./app-names.js";
import type { AppStore } from "./app-store.js";
import type { Category } from "./category.js";
import type { Device } from "./device.js";
import {
  InvalidInputError,
  type InvalidRangeError,
  type StoreError,
} from "./errors.js";
import { type Resolution, resolve } from "./matcher.js";
import type { Project } from "./project.js";
import { Range, resolveRange, UsedRange, usedWindow } from "./range.js";
import { Store } from "./store.js";

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
  deviceId: Schema.optional(Schema.UUID),
});

export const ActivitiesInput = Schema.Struct({
  range: Range,
  deviceId: Schema.optional(Schema.UUID),
  app: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Int.pipe(Schema.positive())),
});

export const ActivitiesPage = Schema.Struct({
  rows: Schema.Array(Activity),
  total: Schema.Int,
  hasMore: Schema.Boolean,
});

/** The note a reply carries when the window holds nothing. */
export const emptyNote = (
  rows: ReadonlyArray<unknown>,
): { readonly note?: string } =>
  rows.length === 0 ? { note: "no activity in this range" } : {};

// Core checks every tool input itself, so the CLI Twin and the Host get the
// same words: the first failing field and the rule it breaks.
const decodeInput =
  <A, I>(schema: Schema.Schema<A, I>) =>
  (input: I): Effect.Effect<A, InvalidInputError> =>
    Schema.decodeUnknown(schema)(input).pipe(
      Effect.mapError((error) => {
        const [issue] = ParseResult.ArrayFormatter.formatErrorSync(error);
        return new InvalidInputError({
          field: issue?.path.join(".") ?? "input",
          reason: issue?.message ?? error.message,
        });
      }),
    );

interface RangeRows {
  readonly rows: ReadonlyArray<{
    readonly activity: Activity;
    readonly resolution: Resolution;
    readonly ms: number;
  }>;
  readonly from: DateTime.Utc;
  readonly to: DateTime.Utc;
  readonly range: UsedRange;
  readonly categories: ReadonlyArray<Category>;
  readonly projects: ReadonlyArray<Project>;
  readonly devices: ReadonlyArray<Device>;
}

const loadRange = (input: {
  readonly range: Range;
  readonly device?: string | undefined;
}): Effect.Effect<
  RangeRows,
  InvalidRangeError | StoreError,
  Store | AppStore | DateTime.CurrentTimeZone
> =>
  Effect.gen(function* () {
    const store = yield* Store;
    const now = yield* DateTime.nowInCurrentZone;
    const { from, to } = yield* resolveRange(input.range, now);
    const stored = yield* store.readActivities({
      deviceId: input.device,
      from,
      to,
    });
    const rules = yield* store.listRules();
    const devices = yield* store.listDevices();
    const deviceById = new Map(devices.map((d) => [d.id, d]));
    const iosBundleIds = [
      ...new Set(
        stored
          .filter((a) => {
            const kind = deviceById.get(a.deviceId)?.kind;
            return kind === "iphone" || kind === "ipad";
          })
          .map((a) => a.bundleId),
      ),
    ];
    const resolved = new Map<string, ResolvedApp | null>(
      yield* Effect.gen(function* () {
        const acc = yield* Ref.make<
          ReadonlyArray<readonly [string, ResolvedApp | null]>
        >([]);
        const storeResult = (bundleId: string, app: ResolvedApp | null) =>
          Ref.update(acc, (xs) => [...xs, [bundleId, app] as const]);
        // Classification and local resolution are one read, so a row that
        // cools down mid-pass still lands in the timed section; only App
        // Store work counts against the budget, and timeoutOption
        // preserves a StoreError where race would hide it.
        const misses: string[] = [];
        yield* Effect.forEach(
          iosBundleIds,
          (bundleId) =>
            Effect.flatMap(classifyAppName(bundleId), (decision) =>
              Either.isLeft(decision)
                ? storeResult(bundleId, Option.getOrNull(decision.left))
                : Effect.sync(() => {
                    misses.push(bundleId);
                  }),
            ),
          { concurrency: 1 },
        );
        yield* Effect.forEach(
          misses,
          (bundleId) =>
            Effect.flatMap(lookupAndCache(bundleId), (app) =>
              storeResult(bundleId, Option.getOrNull(app)),
            ),
          { concurrency: 1 },
        ).pipe(Effect.timeoutOption("15 seconds"));
        return yield* Ref.get(acc);
      }),
    );
    const categories = yield* store.listCategories();
    return {
      rows: stored.map((activity) => {
        const kind = deviceById.get(activity.deviceId)?.kind;
        const info =
          kind === "iphone" || kind === "ipad"
            ? (resolved.get(activity.bundleId) ?? null)
            : null;
        const resolvedActivity =
          info === null ? activity : { ...activity, appName: info.name };
        return {
          activity: resolvedActivity,
          resolution: resolve(
            resolvedActivity,
            rules,
            deviceById.get(activity.deviceId) ?? null,
            info?.genre ?? null,
            categories,
          ),
          ms:
            Math.min(activity.endedAt.epochMillis, to.epochMillis) -
            Math.max(activity.startedAt.epochMillis, from.epochMillis),
        };
      }),
      from,
      to,
      range: usedWindow(from, to, now.zone),
      categories,
      projects: yield* store.listProjects(),
      devices,
    };
  });

export const summary = (
  input: Schema.Schema.Encoded<typeof SummaryInput>,
): Effect.Effect<
  SummaryReply,
  InvalidInputError | InvalidRangeError | StoreError,
  Store | AppStore | DateTime.CurrentTimeZone
> =>
  Effect.gen(function* () {
    const decoded = yield* decodeInput(SummaryInput)(input);
    const { range, rows, categories, projects, devices } =
      yield* loadRange(decoded);
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
  input: TimelineInput,
): Effect.Effect<
  ReadonlyArray<TimelineBlock>,
  InvalidRangeError | StoreError,
  Store | AppStore | DateTime.CurrentTimeZone
> =>
  Effect.gen(function* () {
    const { rows, categories, projects, from, to } = yield* loadRange({
      range: input.range,
      device: input.deviceId,
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
    return blocks.map((block) => ({
      start: DateTime.unsafeMake(block.startMs),
      end: DateTime.unsafeMake(block.endMs),
      app: block.app,
      categoryName: block.categoryName,
      projectName: block.projectName,
    }));
  });

export const activities = (
  input: ActivitiesInput,
): Effect.Effect<
  ActivitiesPage,
  InvalidRangeError | StoreError,
  Store | AppStore | DateTime.CurrentTimeZone
> =>
  Effect.gen(function* () {
    const { rows } = yield* loadRange({
      range: input.range,
      device: input.deviceId,
    });
    const app = input.app?.toLowerCase();
    const filtered =
      app === undefined
        ? rows
        : rows.filter(
            (row) =>
              row.activity.bundleId.toLowerCase() === app ||
              row.activity.appName.toLowerCase() === app,
          );
    const limit = Math.max(0, Math.min(input.limit ?? 200, 200));
    const page = filtered.slice(0, limit);
    return {
      rows: page.map((row) => row.activity),
      total: filtered.length,
      hasMore: filtered.length > page.length,
    };
  });

export type GroupBy = Schema.Schema.Type<typeof GroupBy>;
export type SummaryRow = Schema.Schema.Type<typeof SummaryRow>;
export type SummaryReply = Schema.Schema.Type<typeof SummaryReply>;
export type SummaryInput = Schema.Schema.Type<typeof SummaryInput>;
export type TimelineBlock = Schema.Schema.Type<typeof TimelineBlock>;
export type TimelineInput = Schema.Schema.Type<typeof TimelineInput>;
export type ActivitiesInput = Schema.Schema.Type<typeof ActivitiesInput>;
export type ActivitiesPage = Schema.Schema.Type<typeof ActivitiesPage>;
