import { DateTime, Effect, Either, Option, Ref } from "effect";

import type { Activity } from "./activity.js";
import {
  classifyAppName,
  lookupAndCache,
  type ResolvedApp,
} from "./app-names.js";
import type { AppStore } from "./app-store.js";
import type { Category } from "./category.js";
import type { Device } from "./device.js";
import type { InvalidRangeError, StoreError } from "./errors.js";
import { type Resolution, resolve } from "./matcher.js";
import type { Project } from "./project.js";
import {
  type Range,
  resolveRange,
  type UsedRange,
  usedWindow,
} from "./range.js";
import { Store } from "./store.js";

export interface RangeRows {
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

/**
 * The Activities of a window, clipped to it, with their Rules resolved and
 * iPhone and iPad app names looked up. `deviceIds`, when given, keeps only
 * those Devices, before any App Store lookup.
 */
export const loadRange = (input: {
  readonly range: Range;
  readonly deviceIds?: ReadonlyArray<string> | undefined;
}): Effect.Effect<
  RangeRows,
  InvalidRangeError | StoreError,
  Store | AppStore | DateTime.CurrentTimeZone
> =>
  Effect.gen(function* () {
    const store = yield* Store;
    const now = yield* DateTime.nowInCurrentZone;
    const { from, to } = yield* resolveRange(input.range, now);
    const { deviceIds } = input;
    const read = yield* store.readActivities({ from, to });
    const stored =
      deviceIds === undefined
        ? read
        : read.filter((a) => deviceIds.includes(a.deviceId));
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
