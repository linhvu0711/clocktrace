import { DateTime, Effect, Schema } from "effect";

import type { Activity } from "./activity.js";
import type { Category } from "./category.js";
import type { Device } from "./device.js";
import type { InvalidRangeError, StoreError } from "./errors.js";
import { type Resolution, resolve } from "./matcher.js";
import type { Project } from "./project.js";
import { Range, resolveRange } from "./range.js";
import { Store } from "./store.js";

export const GroupBy = Schema.Literal("category", "project", "app", "device");

export const SummaryRow = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
  seconds: Schema.Int,
  productive: Schema.optional(Schema.Boolean),
});

export const Summary = Schema.Struct({
  rows: Schema.Array(SummaryRow),
  total: Schema.Int,
});

export const SummaryInput = Schema.Struct({
  range: Range,
  groupBy: GroupBy,
  deviceId: Schema.optional(Schema.UUID),
});

interface RangeRows {
  readonly rows: ReadonlyArray<{
    readonly activity: Activity;
    readonly resolution: Resolution;
    readonly ms: number;
  }>;
  readonly from: DateTime.Utc;
  readonly to: DateTime.Utc;
  readonly categories: ReadonlyArray<Category>;
  readonly projects: ReadonlyArray<Project>;
  readonly devices: ReadonlyArray<Device>;
}

const loadRange = (input: {
  readonly range: Range;
  readonly deviceId?: string | undefined;
}): Effect.Effect<
  RangeRows,
  InvalidRangeError | StoreError,
  Store | DateTime.CurrentTimeZone
> =>
  Effect.gen(function* () {
    const store = yield* Store;
    const now = yield* DateTime.nowInCurrentZone;
    const { from, to } = yield* resolveRange(input.range, now);
    const activities = yield* store.readActivities({
      deviceId: input.deviceId,
      from,
      to,
    });
    const rules = yield* store.listRules();
    const devices = yield* store.listDevices();
    const deviceById = new Map(devices.map((d) => [d.id, d]));
    return {
      rows: activities.map((activity) => ({
        activity,
        resolution: resolve(
          activity,
          rules,
          deviceById.get(activity.deviceId) ?? null,
        ),
        ms:
          Math.min(activity.endedAt.epochMillis, to.epochMillis) -
          Math.max(activity.startedAt.epochMillis, from.epochMillis),
      })),
      from,
      to,
      categories: yield* store.listCategories(),
      projects: yield* store.listProjects(),
      devices,
    };
  });

export const summary = (
  input: SummaryInput,
): Effect.Effect<
  Summary,
  InvalidRangeError | StoreError,
  Store | DateTime.CurrentTimeZone
> =>
  Effect.gen(function* () {
    const { rows, categories, projects, devices } = yield* loadRange(input);
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const deviceById = new Map(devices.map((d) => [d.id, d]));
    const groups = new Map<string, SummaryRow>();
    for (const { activity, resolution, ms } of rows) {
      const seconds = Math.round(ms / 1000);
      let row: SummaryRow;
      switch (input.groupBy) {
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
        ...(existing ?? row),
        seconds: (existing?.seconds ?? 0) + seconds,
      });
    }
    const sorted = [...groups.values()].sort(
      (a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name),
    );
    return {
      rows: sorted,
      total: sorted.reduce((sum, row) => sum + row.seconds, 0),
    };
  });

export type GroupBy = Schema.Schema.Type<typeof GroupBy>;
export type SummaryRow = Schema.Schema.Type<typeof SummaryRow>;
export type Summary = Schema.Schema.Type<typeof Summary>;
export type SummaryInput = Schema.Schema.Type<typeof SummaryInput>;
