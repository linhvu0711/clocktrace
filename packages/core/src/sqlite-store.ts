import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { Effect, Schema, type Scope } from "effect";

import type { Device } from "./device.js";
import { NewDevice as NewDeviceSchema } from "./device.js";
import { DatabaseNewerError, StoreError } from "./errors.js";
import { migrations } from "./migrations.js";
import type { StoreShape } from "./store.js";

export const openStore = (
  path: string,
): Effect.Effect<StoreShape, StoreError | DatabaseNewerError, Scope.Scope> =>
  Effect.gen(function* () {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    const db = yield* Effect.acquireRelease(
      Effect.try({
        try: () => new Database(path),
        catch: (cause) => new StoreError({ cause }),
      }),
      (db) => Effect.sync(() => db.close()),
    );
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    const fileVersion = db.pragma("user_version", { simple: true }) as number;
    if (fileVersion > migrations.length) {
      yield* new DatabaseNewerError({
        fileVersion,
        codeVersion: migrations.length,
      });
    }
    yield* Effect.try({
      try: () =>
        db.transaction(() => {
          for (const sql of migrations.slice(fileVersion)) {
            db.exec(sql);
          }
          db.pragma(`user_version = ${migrations.length}`);
        })(),
      catch: (cause) => new StoreError({ cause }),
    });

    const insertDevice = db.prepare(
      "INSERT OR IGNORE INTO devices (id, kind, name, external_id) VALUES (@id, @kind, @name, @externalId)",
    );
    const selectDeviceByExternalId = db.prepare(
      "SELECT id, kind, name, external_id AS externalId FROM devices WHERE external_id = @externalId",
    );
    const selectDevices = db.prepare(
      "SELECT id, kind, name, external_id AS externalId FROM devices ORDER BY name",
    );

    const getOrInsertDevice: StoreShape["getOrInsertDevice"] = (input) =>
      Effect.gen(function* () {
        const device = yield* Schema.validate(NewDeviceSchema)(input);
        return yield* Effect.try({
          try: () => {
            insertDevice.run({ id: randomUUID(), ...device });
            return selectDeviceByExternalId.get({
              externalId: device.externalId,
            }) as Device;
          },
          catch: (cause) => new StoreError({ cause }),
        });
      });

    const listDevices: StoreShape["listDevices"] = () =>
      Effect.try({
        try: () => selectDevices.all() as ReadonlyArray<Device>,
        catch: (cause) => new StoreError({ cause }),
      });

    return { getOrInsertDevice, listDevices };
  });
