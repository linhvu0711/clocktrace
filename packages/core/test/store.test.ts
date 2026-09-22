import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { DateTime, Effect, Either, Option } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DatabaseNewerError, StoreShape } from "../src/index.js";
import { openStore, Store } from "../src/index.js";

describe("store", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clocktrace-"));
    path = join(dir, "clocktrace.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const useStore = <A, E>(
    f: (store: StoreShape) => Effect.Effect<A, E>,
  ): Promise<A> =>
    Effect.runPromise(Effect.scoped(Effect.flatMap(openStore(path), f)));

  it("creates the file, six tables, and schema version 1", async () => {
    // Given: the file does not exist
    // When
    await Effect.runPromise(Effect.scoped(openStore(path)));
    const db = new Database(path);
    const version = db.pragma("user_version", { simple: true });
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all() as ReadonlyArray<{ name: string }>;
    db.close();
    // Then
    expect(existsSync(path)).toBe(true);
    expect(version).toBe(1);
    expect(tables.map((row) => row.name)).toEqual([
      "activities",
      "categories",
      "devices",
      "projects",
      "rules",
      "settings",
    ]);
  });

  it("a second open changes nothing", async () => {
    // Given: a first open that inserted one device and closed
    await useStore((store) =>
      store.getOrInsertDevice({
        kind: "mac",
        name: "Studio",
        externalId: "mac-1",
      }),
    );
    // When: a second open
    const devices = await useStore((store) => store.listDevices());
    const db = new Database(path);
    const version = db.pragma("user_version", { simple: true });
    db.close();
    // Then
    expect(devices).toHaveLength(1);
    expect(devices[0]?.externalId).toBe("mac-1");
    expect(version).toBe(1);
  });

  it("fails when the file is newer than the code", async () => {
    // Given: a file stamped with a newer schema version
    const db = new Database(path);
    db.pragma("user_version = 99");
    db.close();
    // When
    const result = await Effect.runPromise(
      Effect.either(Effect.scoped(openStore(path))),
    );
    // Then
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      const error = result.left as DatabaseNewerError;
      expect(error._tag).toBe("DatabaseNewerError");
      expect(error.message).toBe(
        "database was written by clocktrace 99, this is 1 · upgrade clocktrace",
      );
      expect(error.fileVersion).toBe(99);
      expect(error.codeVersion).toBe(1);
    }
  });

  it("opens the file in WAL mode", async () => {
    // Given: the file was opened once and closed
    await Effect.runPromise(Effect.scoped(openStore(path)));
    // When
    const db = new Database(path);
    const mode = db.pragma("journal_mode", { simple: true });
    db.close();
    // Then
    expect(mode).toBe("wal");
  });

  it("getOrInsertDevice inserts once and returns the same row", async () => {
    // Given: an open store
    const { first, second, devices } = await useStore((store) =>
      Effect.gen(function* () {
        // When: the same device is inserted twice
        const first = yield* store.getOrInsertDevice({
          kind: "mac",
          name: "Studio",
          externalId: "mac-1",
        });
        const second = yield* store.getOrInsertDevice({
          kind: "mac",
          name: "Other",
          externalId: "mac-1",
        });
        const devices = yield* store.listDevices();
        return { first, second, devices };
      }),
    );
    // Then
    expect(second.id).toBe(first.id);
    expect(first.id).toHaveLength(36);
    expect(first.kind).toBe("mac");
    expect(first.name).toBe("Studio");
    expect(first.externalId).toBe("mac-1");
    expect(devices).toHaveLength(1);
  });

  it("listDevices returns devices by name", async () => {
    // Given: an open store with two devices
    const devices = await useStore((store) =>
      Effect.gen(function* () {
        yield* store.getOrInsertDevice({
          kind: "ipad",
          name: "Pad",
          externalId: "ipad-1",
        });
        yield* store.getOrInsertDevice({
          kind: "iphone",
          name: "Fone",
          externalId: "iphone-1",
        });
        // When
        return yield* store.listDevices();
      }),
    );
    // Then
    expect(devices.map((d) => d.name)).toEqual(["Fone", "Pad"]);
  });

  it("Store.Default(path) provides the store", async () => {
    // Given: the temp path
    // When
    const devices = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        return yield* store.listDevices();
      }).pipe(Effect.provide(Store.Default(path))),
    );
    // Then
    expect(devices).toEqual([]);
  });

  const t = (s: string) => DateTime.unsafeMake(s);

  const seedDevice = (store: StoreShape) =>
    store.getOrInsertDevice({
      kind: "mac",
      name: "Studio",
      externalId: "mac-1",
    });

  const seedActivities = (store: StoreShape, deviceId: string) =>
    Effect.gen(function* () {
      yield* store.insertActivity({
        deviceId,
        bundleId: "com.google.Chrome",
        appName: "Chrome",
        title: "GitHub",
        url: "https://github.com",
        startedAt: t("2026-09-17T10:30:00.000Z"),
        endedAt: t("2026-09-17T11:00:00.000Z"),
      });
      yield* store.insertActivity({
        deviceId,
        bundleId: "com.apple.Terminal",
        appName: "Terminal",
        title: "zsh",
        url: null,
        startedAt: t("2026-09-17T10:00:00.000Z"),
        endedAt: t("2026-09-17T10:30:00.000Z"),
      });
      yield* store.insertActivity({
        deviceId,
        bundleId: "com.apple.mail",
        appName: "Mail",
        title: null,
        url: null,
        startedAt: t("2026-09-17T11:00:00.000Z"),
        endedAt: t("2026-09-17T11:30:00.000Z"),
      });
    });

  it("insertActivity returns the row with a UUID id", async () => {
    // Given: an open store and a device
    const activity = await useStore((store) =>
      Effect.gen(function* () {
        const d = yield* seedDevice(store);
        // When
        return yield* store.insertActivity({
          deviceId: d.id,
          bundleId: "com.apple.Terminal",
          appName: "Terminal",
          title: "zsh",
          url: null,
          startedAt: t("2026-09-17T10:00:00.000Z"),
          endedAt: t("2026-09-17T10:30:00.000Z"),
        });
      }),
    );
    // Then
    expect(activity.id).toHaveLength(36);
    expect(activity.title).toBe("zsh");
    expect(activity.url).toBeNull();
    expect(DateTime.formatIso(activity.startedAt)).toBe(
      "2026-09-17T10:00:00.000Z",
    );
    expect(DateTime.formatIso(activity.endedAt)).toBe(
      "2026-09-17T10:30:00.000Z",
    );
  });

  it("the activity interface has insert and read only", async () => {
    // Given: an open store
    const keys = await useStore((store) =>
      Effect.succeed(
        Object.keys(store)
          .filter((k) => /activit/i.test(k))
          .sort(),
      ),
    );
    // Then
    expect(keys).toEqual([
      "insertActivity",
      "latestActivityEnd",
      "readActivities",
    ]);
  });

  it("readActivities returns overlapping rows in start order", async () => {
    // Given: three activities on one device, inserted out of order
    const rows = await useStore((store) =>
      Effect.gen(function* () {
        const d = yield* seedDevice(store);
        yield* seedActivities(store, d.id);
        // When
        return yield* store.readActivities({
          from: t("2026-09-17T10:15:00.000Z"),
          to: t("2026-09-17T10:45:00.000Z"),
        });
      }),
    );
    // Then
    expect(rows.map((a) => a.appName)).toEqual(["Terminal", "Chrome"]);
    expect(rows[0]?.url).toBeNull();
    expect(rows[1]?.url).toBe("https://github.com");
  });

  it("readActivities filters by deviceId", async () => {
    // Given: the three rows on d plus one Safari row on a second device
    const rows = await useStore((store) =>
      Effect.gen(function* () {
        const d = yield* seedDevice(store);
        yield* seedActivities(store, d.id);
        const e = yield* store.getOrInsertDevice({
          kind: "iphone",
          name: "Fone",
          externalId: "iphone-1",
        });
        yield* store.insertActivity({
          deviceId: e.id,
          bundleId: "com.apple.mobilesafari",
          appName: "Safari",
          title: null,
          url: null,
          startedAt: t("2026-09-17T10:00:00.000Z"),
          endedAt: t("2026-09-17T11:00:00.000Z"),
        });
        // When
        return yield* store.readActivities({
          deviceId: e.id,
          from: t("2026-09-17T10:00:00.000Z"),
          to: t("2026-09-17T12:00:00.000Z"),
        });
      }),
    );
    // Then
    expect(rows).toHaveLength(1);
    expect(rows[0]?.appName).toBe("Safari");
  });

  it("readActivities returns [] when nothing overlaps", async () => {
    // Given: the three rows on d
    const rows = await useStore((store) =>
      Effect.gen(function* () {
        const d = yield* seedDevice(store);
        yield* seedActivities(store, d.id);
        // When
        return yield* store.readActivities({
          from: t("2026-09-17T12:00:00.000Z"),
          to: t("2026-09-17T13:00:00.000Z"),
        });
      }),
    );
    // Then
    expect(rows).toEqual([]);
  });

  it("readActivities returns [] for a zero-length range", async () => {
    // Given: the three rows on d
    const rows = await useStore((store) =>
      Effect.gen(function* () {
        const d = yield* seedDevice(store);
        yield* seedActivities(store, d.id);
        // When
        return yield* store.readActivities({
          from: t("2026-09-17T10:15:00.000Z"),
          to: t("2026-09-17T10:15:00.000Z"),
        });
      }),
    );
    // Then
    expect(rows).toEqual([]);
  });

  it("latestActivityEnd is none on an empty store", async () => {
    // Given: a fresh file store
    // When
    const end = await useStore((store) => store.latestActivityEnd());
    // Then
    expect(end).toEqual(Option.none());
  });

  it("latestActivityEnd is the newest end", async () => {
    // Given: a device and two Activities, the newest end inserted first
    const end = await useStore((store) =>
      Effect.gen(function* () {
        const d = yield* seedDevice(store);
        yield* store.insertActivity({
          deviceId: d.id,
          bundleId: "com.apple.finder",
          appName: "Finder",
          title: null,
          url: null,
          startedAt: t("2026-09-18T11:00:00.000Z"),
          endedAt: t("2026-09-18T12:00:00.000Z"),
        });
        yield* store.insertActivity({
          deviceId: d.id,
          bundleId: "com.apple.finder",
          appName: "Finder",
          title: null,
          url: null,
          startedAt: t("2026-09-18T09:00:00.000Z"),
          endedAt: t("2026-09-18T10:00:00.000Z"),
        });
        // When
        return yield* store.latestActivityEnd();
      }),
    );
    // Then
    expect(Option.map(end, DateTime.formatIso)).toEqual(
      Option.some("2026-09-18T12:00:00.000Z"),
    );
  });

  it("latestActivityEnd filters by deviceId", async () => {
    // Given: a Mac Activity ending later than the iPhone's
    const ends = await useStore((store) =>
      Effect.gen(function* () {
        const d = yield* seedDevice(store);
        yield* store.insertActivity({
          deviceId: d.id,
          bundleId: "com.apple.finder",
          appName: "Finder",
          title: null,
          url: null,
          startedAt: t("2026-09-18T11:00:00.000Z"),
          endedAt: t("2026-09-18T12:00:00.000Z"),
        });
        const e = yield* store.getOrInsertDevice({
          kind: "iphone",
          name: "Fone",
          externalId: "iphone-1",
        });
        yield* store.insertActivity({
          deviceId: e.id,
          bundleId: "com.apple.mobilesafari",
          appName: "Safari",
          title: null,
          url: null,
          startedAt: t("2026-09-18T09:00:00.000Z"),
          endedAt: t("2026-09-18T10:00:00.000Z"),
        });
        // When
        return {
          phone: yield* store.latestActivityEnd(e.id),
          all: yield* store.latestActivityEnd(),
        };
      }),
    );
    // Then
    expect(Option.map(ends.phone, DateTime.formatIso)).toEqual(
      Option.some("2026-09-18T10:00:00.000Z"),
    );
    expect(Option.map(ends.all, DateTime.formatIso)).toEqual(
      Option.some("2026-09-18T12:00:00.000Z"),
    );
  });

  it("insertActivity rejects endedAt before startedAt", async () => {
    // Given: an open store and a device
    const { result, rows } = await useStore((store) =>
      Effect.gen(function* () {
        const d = yield* seedDevice(store);
        // When
        const result = yield* Effect.either(
          store.insertActivity({
            deviceId: d.id,
            bundleId: "com.apple.Terminal",
            appName: "Terminal",
            title: null,
            url: null,
            startedAt: t("2026-09-17T10:30:00.000Z"),
            endedAt: t("2026-09-17T10:00:00.000Z"),
          }),
        );
        const rows = yield* store.readActivities({
          from: t("2026-09-17T00:00:00.000Z"),
          to: t("2026-09-18T00:00:00.000Z"),
        });
        return { result, rows };
      }),
    );
    // Then
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("ParseError");
      expect(result.left.message).toContain('["endedAt"]');
    }
    expect(rows).toEqual([]);
  });

  it("insertActivity rejects an unknown deviceId", async () => {
    // Given: an open store, no devices
    const result = await useStore((store) =>
      Effect.either(
        store.insertActivity({
          deviceId: "00000000-0000-4000-8000-000000000000",
          bundleId: "com.apple.Terminal",
          appName: "Terminal",
          title: null,
          url: null,
          startedAt: t("2026-09-17T10:00:00.000Z"),
          endedAt: t("2026-09-17T10:30:00.000Z"),
        }),
      ),
    );
    // Then
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("StoreError");
    }
  });

  it("insertCategory and listCategories", async () => {
    // Given: an open store
    const { inserted, categories } = await useStore((store) =>
      Effect.gen(function* () {
        // When
        const inserted = yield* store.insertCategory({
          name: "Social",
          productive: false,
        });
        yield* store.insertCategory({ name: "Coding", productive: true });
        const categories = yield* store.listCategories();
        return { inserted, categories };
      }),
    );
    // Then
    expect(inserted.id).toHaveLength(36);
    expect(inserted.name).toBe("Social");
    expect(inserted.productive).toBe(false);
    expect(
      categories.map((c) => ({ name: c.name, productive: c.productive })),
    ).toEqual([
      { name: "Coding", productive: true },
      { name: "Social", productive: false },
    ]);
  });

  it("updateCategory changes name and flag", async () => {
    // Given: an open store with one category
    const { inserted, result, categories } = await useStore((store) =>
      Effect.gen(function* () {
        const inserted = yield* store.insertCategory({
          name: "Social",
          productive: false,
        });
        // When
        const result = yield* store.updateCategory(inserted.id, {
          name: "Social media",
          productive: true,
        });
        const categories = yield* store.listCategories();
        return { inserted, result, categories };
      }),
    );
    // Then
    expect(result).toEqual(
      Option.some({
        id: inserted.id,
        name: "Social media",
        productive: true,
      }),
    );
    expect(categories).toEqual([
      { id: inserted.id, name: "Social media", productive: true },
    ]);
  });

  it("updateCategory of an unknown id is none", async () => {
    // Given: an open store, no categories
    // When
    const result = await useStore((store) =>
      store.updateCategory("00000000-0000-4000-8000-000000000077", {
        name: "X",
        productive: true,
      }),
    );
    // Then
    expect(Option.isNone(result)).toBe(true);
  });

  it("updateProject renames", async () => {
    // Given: an open store with one project
    const { inserted, result, projects } = await useStore((store) =>
      Effect.gen(function* () {
        const inserted = yield* store.insertProject({ name: "Thesis" });
        // When
        const result = yield* store.updateProject(inserted.id, {
          name: "PhD thesis",
        });
        const projects = yield* store.listProjects();
        return { inserted, result, projects };
      }),
    );
    // Then
    expect(result).toEqual(
      Option.some({ id: inserted.id, name: "PhD thesis" }),
    );
    expect(projects).toEqual([{ id: inserted.id, name: "PhD thesis" }]);
  });

  it("updateProject of an unknown id is none", async () => {
    // Given: an open store, no projects
    // When
    const result = await useStore((store) =>
      store.updateProject("00000000-0000-4000-8000-000000000077", {
        name: "X",
      }),
    );
    // Then
    expect(Option.isNone(result)).toBe(true);
  });

  it("insertProject and listProjects", async () => {
    // Given: an open store
    const { inserted, projects } = await useStore((store) =>
      Effect.gen(function* () {
        // When
        const inserted = yield* store.insertProject({ name: "Thesis" });
        yield* store.insertProject({ name: "Clocktrace" });
        const projects = yield* store.listProjects();
        return { inserted, projects };
      }),
    );
    // Then
    expect(inserted.id).toHaveLength(36);
    expect(inserted.name).toBe("Thesis");
    expect(projects.map((p) => p.name)).toEqual(["Clocktrace", "Thesis"]);
  });

  it("deleteCategory removes a Category and reports absent", async () => {
    // Given: an open store with one category
    const { first, second, categories } = await useStore((store) =>
      Effect.gen(function* () {
        const inserted = yield* store.insertCategory({
          name: "Social",
          productive: false,
        });
        // When
        const first = yield* store.deleteCategory(inserted.id);
        const second = yield* store.deleteCategory(inserted.id);
        const categories = yield* store.listCategories();
        return { first, second, categories };
      }),
    );
    // Then
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(categories).toEqual([]);
  });

  it("deleteProject removes a Project and reports absent", async () => {
    // Given: an open store with one project
    const { first, second, projects } = await useStore((store) =>
      Effect.gen(function* () {
        const inserted = yield* store.insertProject({ name: "Thesis" });
        // When
        const first = yield* store.deleteProject(inserted.id);
        const second = yield* store.deleteProject(inserted.id);
        const projects = yield* store.listProjects();
        return { first, second, projects };
      }),
    );
    // Then
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(projects).toEqual([]);
  });

  it("insertRule, listRules, deleteRule", async () => {
    // Given: an open store and a category
    const { c, r0, positions, first, second, remaining } = await useStore(
      (store) =>
        Effect.gen(function* () {
          const c = yield* store.insertCategory({
            name: "Coding",
            productive: true,
          });
          // When
          const r1 = yield* store.insertRule({
            position: 1,
            field: "title",
            compare: "ends with",
            value: "(Incognito)",
            effect: "private",
            target: null,
          });
          const r0 = yield* store.insertRule({
            position: 0,
            field: "app",
            compare: "is",
            value: "com.apple.Terminal",
            effect: "category",
            target: c.id,
          });
          const positions = (yield* store.listRules()).map((r) => r.position);
          const first = yield* store.deleteRule(r1.id);
          const second = yield* store.deleteRule(r1.id);
          const remaining = yield* store.listRules();
          return { c, r0, positions, first, second, remaining };
        }),
    );
    // Then
    expect(r0.id).toHaveLength(36);
    expect(r0.position).toBe(0);
    expect(r0.field).toBe("app");
    expect(r0.compare).toBe("is");
    expect(r0.value).toBe("com.apple.Terminal");
    expect(r0.effect).toBe("category");
    expect(positions).toEqual([0, 1]);
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.target).toBe(c.id);
  });

  it("deleteRule shifts later positions down", async () => {
    // Given: three private rules at positions 0, 1, 2
    const remaining = await useStore((store) =>
      Effect.gen(function* () {
        const insert = (value: string, position: number) =>
          store.insertRule({
            position,
            field: "title",
            compare: "ends with",
            value,
            effect: "private",
            target: null,
          });
        yield* insert("a", 0);
        const b = yield* insert("b", 1);
        yield* insert("c", 2);
        // When
        yield* store.deleteRule(b.id);
        return yield* store.listRules();
      }),
    );
    // Then
    expect(remaining.map((r) => [r.position, r.value])).toEqual([
      [0, "a"],
      [1, "c"],
    ]);
  });

  it("setSetting and getSetting", async () => {
    // Given: an open store
    const { before, after } = await useStore((store) =>
      Effect.gen(function* () {
        // When
        const before = yield* store.getSetting("starterSet");
        yield* store.setSetting("starterSet", "1");
        yield* store.setSetting("starterSet", "2");
        const after = yield* store.getSetting("starterSet");
        return { before, after };
      }),
    );
    // Then
    expect(Option.isNone(before)).toBe(true);
    expect(after).toEqual(Option.some("2"));
  });

  it("Store.Test provides an in-memory store", async () => {
    // Given: nothing on disk
    // When
    const devices = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* store.getOrInsertDevice({
          kind: "mac",
          name: "Studio",
          externalId: "mac-1",
        });
        return yield* store.listDevices();
      }).pipe(Effect.provide(Store.Test)),
    );
    // Then
    expect(devices).toHaveLength(1);
    expect(existsSync(":memory:")).toBe(false);
  });
});
