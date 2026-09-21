import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { DateTime, Effect, Option, Schema, type Scope } from "effect";

import type { Activity } from "./activity.js";
import { NewActivity as NewActivitySchema } from "./activity.js";
import type { Category } from "./category.js";
import { NewCategory as NewCategorySchema } from "./category.js";
import type { Device } from "./device.js";
import { NewDevice as NewDeviceSchema } from "./device.js";
import { DatabaseNewerError, StoreError } from "./errors.js";
import { migrations } from "./migrations.js";
import type { Project } from "./project.js";
import { NewProject as NewProjectSchema } from "./project.js";
import type { Rule } from "./rule.js";
import { NewRule as NewRuleSchema } from "./rule.js";
import {
  starterCategories,
  starterRules,
  starterSetKey,
} from "./starter-set.js";
import type { StoreShape } from "./store.js";

export const openStore = (
  path: string,
): Effect.Effect<StoreShape, StoreError | DatabaseNewerError, Scope.Scope> =>
  Effect.gen(function* () {
    const toStoreError = (cause: unknown) => new StoreError({ cause });
    yield* Effect.try({
      try: () => {
        if (path !== ":memory:") {
          mkdirSync(dirname(path), { recursive: true });
        }
      },
      catch: toStoreError,
    });
    const db = yield* Effect.acquireRelease(
      Effect.try({
        try: () => new Database(path),
        catch: toStoreError,
      }),
      (db) => Effect.sync(() => db.close()),
    );
    yield* Effect.try({
      try: () => {
        db.pragma("journal_mode = WAL");
        db.pragma("foreign_keys = ON");
        db.pragma("busy_timeout = 5000");
      },
      catch: toStoreError,
    });
    const fileVersion = yield* Effect.try({
      try: () =>
        db
          .transaction(() => {
            const v = db.pragma("user_version", { simple: true }) as number;
            if (v <= migrations.length) {
              for (const sql of migrations.slice(v)) {
                db.exec(sql);
              }
              db.pragma(`user_version = ${migrations.length}`);
            }
            return v;
          })
          .immediate(),
      catch: toStoreError,
    });
    if (fileVersion > migrations.length) {
      yield* new DatabaseNewerError({
        fileVersion,
        codeVersion: migrations.length,
      });
    }
    const prepare = <T>(f: () => T) =>
      Effect.try({ try: f, catch: toStoreError });

    const insertDevice = yield* prepare(() =>
      db.prepare(
        "INSERT OR IGNORE INTO devices (id, kind, name, external_id) VALUES (@id, @kind, @name, @externalId)",
      ),
    );
    const selectDeviceByExternalId = yield* prepare(() =>
      db.prepare(
        "SELECT id, kind, name, external_id AS externalId FROM devices WHERE external_id = @externalId",
      ),
    );
    const selectDevices = yield* prepare(() =>
      db.prepare(
        "SELECT id, kind, name, external_id AS externalId FROM devices ORDER BY name",
      ),
    );
    const insertActivityStatement = yield* prepare(() =>
      db.prepare(
        "INSERT INTO activities (id, device_id, bundle_id, app_name, title, url, started_at, ended_at) VALUES (@id, @deviceId, @bundleId, @appName, @title, @url, @startedAt, @endedAt)",
      ),
    );
    const insertCategoryStatement = yield* prepare(() =>
      db.prepare(
        "INSERT INTO categories (id, name, productive) VALUES (@id, @name, @productive)",
      ),
    );
    const selectCategories = yield* prepare(() =>
      db.prepare("SELECT id, name, productive FROM categories ORDER BY name"),
    );
    const updateCategoryStatement = yield* prepare(() =>
      db.prepare(
        "UPDATE categories SET name = @name, productive = @productive WHERE id = @id",
      ),
    );
    const deleteCategoryStatement = yield* prepare(() =>
      db.prepare("DELETE FROM categories WHERE id = @id"),
    );
    const insertProjectStatement = yield* prepare(() =>
      db.prepare("INSERT INTO projects (id, name) VALUES (@id, @name)"),
    );
    const selectProjects = yield* prepare(() =>
      db.prepare("SELECT id, name FROM projects ORDER BY name"),
    );
    const updateProjectStatement = yield* prepare(() =>
      db.prepare("UPDATE projects SET name = @name WHERE id = @id"),
    );
    const deleteProjectStatement = yield* prepare(() =>
      db.prepare("DELETE FROM projects WHERE id = @id"),
    );
    const insertRuleStatement = yield* prepare(() =>
      db.prepare(
        "INSERT INTO rules (id, position, field, compare, value, effect, target) VALUES (@id, @position, @field, @compare, @value, @effect, @target)",
      ),
    );
    const selectRules = yield* prepare(() =>
      db.prepare(
        "SELECT id, position, field, compare, value, effect, target FROM rules ORDER BY position",
      ),
    );
    const deleteRuleStatement = yield* prepare(() =>
      db.prepare("DELETE FROM rules WHERE id = @id"),
    );
    const selectRulePosition = yield* prepare(() =>
      db.prepare("SELECT position FROM rules WHERE id = @id"),
    );
    const shiftRulesDown = yield* prepare(() =>
      db.prepare(
        "UPDATE rules SET position = position - 1 WHERE position > @position",
      ),
    );
    const upsertSetting = yield* prepare(() =>
      db.prepare(
        "INSERT INTO settings (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ),
    );
    const selectSetting = yield* prepare(() =>
      db.prepare("SELECT value FROM settings WHERE key = @key"),
    );
    const selectActivities = yield* prepare(() =>
      db.prepare(
        "SELECT id, device_id AS deviceId, bundle_id AS bundleId, app_name AS appName, title, url, started_at AS startedAt, ended_at AS endedAt FROM activities WHERE started_at < @to AND ended_at > @from AND (@deviceId IS NULL OR device_id = @deviceId) ORDER BY started_at",
      ),
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

    const insertActivity: StoreShape["insertActivity"] = (input) =>
      Effect.gen(function* () {
        const activity = yield* Schema.validate(NewActivitySchema)(input);
        return yield* Effect.try({
          try: () => {
            const id = randomUUID();
            insertActivityStatement.run({
              id,
              deviceId: activity.deviceId,
              bundleId: activity.bundleId,
              appName: activity.appName,
              title: activity.title,
              url: activity.url,
              startedAt: DateTime.formatIso(activity.startedAt),
              endedAt: DateTime.formatIso(activity.endedAt),
            });
            return { id, ...activity };
          },
          catch: (cause) => new StoreError({ cause }),
        });
      });

    const readActivities: StoreShape["readActivities"] = (query) => {
      if (query.to.epochMillis <= query.from.epochMillis) {
        return Effect.succeed([]);
      }
      return Effect.try({
        try: () => {
          const rows = selectActivities.all({
            from: DateTime.formatIso(query.from),
            to: DateTime.formatIso(query.to),
            deviceId: query.deviceId ?? null,
          }) as ReadonlyArray<{
            id: string;
            deviceId: string;
            bundleId: string;
            appName: string;
            title: string | null;
            url: string | null;
            startedAt: string;
            endedAt: string;
          }>;
          return rows.map(
            (row): Activity => ({
              ...row,
              startedAt: DateTime.unsafeMake(row.startedAt),
              endedAt: DateTime.unsafeMake(row.endedAt),
            }),
          );
        },
        catch: (cause) => new StoreError({ cause }),
      });
    };

    const insertCategory: StoreShape["insertCategory"] = (input) =>
      Effect.gen(function* () {
        const category = yield* Schema.validate(NewCategorySchema)(input);
        return yield* Effect.try({
          try: () => {
            const id = randomUUID();
            insertCategoryStatement.run({
              id,
              name: category.name,
              productive: category.productive ? 1 : 0,
            });
            return { id, ...category };
          },
          catch: (cause) => new StoreError({ cause }),
        });
      });

    const listCategories: StoreShape["listCategories"] = () =>
      Effect.try({
        try: () =>
          (
            selectCategories.all() as ReadonlyArray<{
              id: string;
              name: string;
              productive: number;
            }>
          ).map(
            (row): Category => ({
              ...row,
              productive: row.productive === 1,
            }),
          ),
        catch: (cause) => new StoreError({ cause }),
      });

    const updateCategory: StoreShape["updateCategory"] = (id, input) =>
      Effect.gen(function* () {
        const category = yield* Schema.validate(NewCategorySchema)(input);
        return yield* Effect.try({
          try: () => {
            const run = updateCategoryStatement.run({
              id,
              name: category.name,
              productive: category.productive ? 1 : 0,
            });
            return run.changes === 0
              ? Option.none()
              : Option.some({ id, ...category });
          },
          catch: (cause) => new StoreError({ cause }),
        });
      });

    const deleteCategory: StoreShape["deleteCategory"] = (id) =>
      Effect.try({
        try: () => deleteCategoryStatement.run({ id }).changes > 0,
        catch: (cause) => new StoreError({ cause }),
      });

    const insertProject: StoreShape["insertProject"] = (input) =>
      Effect.gen(function* () {
        const project = yield* Schema.validate(NewProjectSchema)(input);
        return yield* Effect.try({
          try: () => {
            const id = randomUUID();
            insertProjectStatement.run({ id, name: project.name });
            return { id, ...project };
          },
          catch: (cause) => new StoreError({ cause }),
        });
      });

    const listProjects: StoreShape["listProjects"] = () =>
      Effect.try({
        try: () => selectProjects.all() as ReadonlyArray<Project>,
        catch: (cause) => new StoreError({ cause }),
      });

    const updateProject: StoreShape["updateProject"] = (id, input) =>
      Effect.gen(function* () {
        const project = yield* Schema.validate(NewProjectSchema)(input);
        return yield* Effect.try({
          try: () => {
            const run = updateProjectStatement.run({
              id,
              name: project.name,
            });
            return run.changes === 0
              ? Option.none()
              : Option.some({ id, ...project });
          },
          catch: (cause) => new StoreError({ cause }),
        });
      });

    const deleteProject: StoreShape["deleteProject"] = (id) =>
      Effect.try({
        try: () => deleteProjectStatement.run({ id }).changes > 0,
        catch: (cause) => new StoreError({ cause }),
      });

    const insertRule: StoreShape["insertRule"] = (input) =>
      Effect.gen(function* () {
        const rule = yield* Schema.validate(NewRuleSchema)(input);
        return yield* Effect.try({
          try: () => {
            const id = randomUUID();
            insertRuleStatement.run({ id, ...rule });
            return { id, ...rule };
          },
          catch: (cause) => new StoreError({ cause }),
        });
      });

    const listRules: StoreShape["listRules"] = () =>
      Effect.try({
        try: () => selectRules.all() as ReadonlyArray<Rule>,
        catch: (cause) => new StoreError({ cause }),
      });

    const deleteRule: StoreShape["deleteRule"] = (id) =>
      Effect.try({
        try: () =>
          db
            .transaction(() => {
              const row = selectRulePosition.get({ id }) as
                | { position: number }
                | undefined;
              if (row === undefined) {
                return false;
              }
              deleteRuleStatement.run({ id });
              shiftRulesDown.run({ position: row.position });
              return true;
            })
            .immediate(),
        catch: (cause) => new StoreError({ cause }),
      });

    const getSetting: StoreShape["getSetting"] = (key) =>
      Effect.try({
        try: () => {
          const row = selectSetting.get({ key }) as
            | { value: string }
            | undefined;
          return Option.fromNullable(row?.value);
        },
        catch: (cause) => new StoreError({ cause }),
      });

    const setSetting: StoreShape["setSetting"] = (key, value) =>
      Effect.try({
        try: () => {
          upsertSetting.run({ key, value });
        },
        catch: (cause) => new StoreError({ cause }),
      });

    const seedStarterSet: StoreShape["seedStarterSet"] = () =>
      Effect.try({
        try: () =>
          db
            .transaction(() => {
              if (selectSetting.get({ key: starterSetKey }) !== undefined) {
                return;
              }
              const ids = new Map<string, string>();
              for (const category of starterCategories) {
                const id = randomUUID();
                insertCategoryStatement.run({
                  id,
                  name: category.name,
                  productive: category.productive ? 1 : 0,
                });
                ids.set(category.name, id);
              }
              for (const [position, starter] of starterRules.entries()) {
                insertRuleStatement.run({
                  id: randomUUID(),
                  position,
                  field: starter.field,
                  compare: starter.compare,
                  value: starter.value,
                  effect: starter.effect,
                  target:
                    starter.category === null
                      ? null
                      : (ids.get(starter.category) ?? null),
                });
              }
              upsertSetting.run({ key: starterSetKey, value: "1" });
            })
            .immediate(),
        catch: (cause) => new StoreError({ cause }),
      });

    return {
      getOrInsertDevice,
      listDevices,
      insertActivity,
      readActivities,
      insertCategory,
      listCategories,
      updateCategory,
      deleteCategory,
      insertProject,
      listProjects,
      updateProject,
      deleteProject,
      insertRule,
      listRules,
      deleteRule,
      getSetting,
      setSetting,
      seedStarterSet,
    };
  });
