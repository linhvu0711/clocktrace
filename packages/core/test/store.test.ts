import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Effect, Either } from "effect";
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
      expect(error.message).toBe("database is newer than this clocktrace");
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
