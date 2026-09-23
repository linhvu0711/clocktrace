// Test seeds shared by the CLI and MCP tests, published as
// @clocktrace/core/testing so no app test holds its own copy.
import { DateTime, Effect } from "effect";

import type { StoreShape } from "./store.js";

const t = (s: string) => DateTime.unsafeMake(s);

// Studio: Code 08:00 to 09:30Z, then Chrome to 09:40Z; 01:00 to 02:40 in Los Angeles
export const seedDay = (store: StoreShape) =>
  Effect.gen(function* () {
    const studio = yield* store.upsertDevice({
      kind: "mac",
      name: "Studio",
      externalId: "mac-1",
    });
    yield* store.insertActivity({
      deviceId: studio.id,
      bundleId: "com.microsoft.VSCode",
      appName: "Code",
      title: "a",
      url: null,
      startedAt: t("2026-09-18T08:00:00.000Z"),
      endedAt: t("2026-09-18T09:30:00.000Z"),
    });
    yield* store.insertActivity({
      deviceId: studio.id,
      bundleId: "com.google.Chrome",
      appName: "Google Chrome",
      title: "b",
      url: "https://github.com/acme/shop",
      startedAt: t("2026-09-18T09:30:00.000Z"),
      endedAt: t("2026-09-18T09:40:00.000Z"),
    });
    return studio;
  });

// seedDay plus a Laptop with one Safari Activity, 10:00 to 10:05Z
export const seedTwoDevices = (store: StoreShape) =>
  Effect.gen(function* () {
    const studio = yield* seedDay(store);
    const laptop = yield* store.upsertDevice({
      kind: "mac",
      name: "Laptop",
      externalId: "mac-2",
    });
    yield* store.insertActivity({
      deviceId: laptop.id,
      bundleId: "com.apple.Safari",
      appName: "Safari",
      title: "c",
      url: null,
      startedAt: t("2026-09-18T10:00:00.000Z"),
      endedAt: t("2026-09-18T10:05:00.000Z"),
    });
    return studio;
  });

// count one-minute Code Activities on Studio from 08:00Z
export const seedMany = (store: StoreShape, count: number) =>
  Effect.gen(function* () {
    const studio = yield* store.upsertDevice({
      kind: "mac",
      name: "Studio",
      externalId: "mac-1",
    });
    for (let i = 0; i < count; i++) {
      const startedAt = Date.UTC(2026, 8, 18, 8) + i * 60_000;
      yield* store.insertActivity({
        deviceId: studio.id,
        bundleId: "com.microsoft.VSCode",
        appName: "Code",
        title: null,
        url: null,
        startedAt: DateTime.unsafeMake(startedAt),
        endedAt: DateTime.unsafeMake(startedAt + 60_000),
      });
    }
  });
