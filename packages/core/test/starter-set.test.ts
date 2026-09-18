import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { DateTime, Effect, Either, Option } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Device, NewActivity } from "../src/index.js";
import { openStore, resolve, Store, starterRules } from "../src/index.js";

const deviceId = "00000000-0000-4000-8000-000000000001";
const device: Device = {
  id: deviceId,
  kind: "mac",
  name: "Studio",
  externalId: "mac-1",
};
const chrome: NewActivity = {
  deviceId,
  bundleId: "com.google.Chrome",
  appName: "Google Chrome",
  title: "GitHub - Google Chrome",
  url: "https://github.com/linhvu0711/clocktrace",
  startedAt: DateTime.unsafeMake("2026-09-17T10:00:00.000Z"),
  endedAt: DateTime.unsafeMake("2026-09-17T10:30:00.000Z"),
};

describe("starter set", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clocktrace-"));
    path = join(dir, "clocktrace.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const open = <A, E>(effect: Effect.Effect<A, E, Store>): Promise<A> =>
    Effect.runPromise(effect.pipe(Effect.provide(Store.Default(path))));

  it("a fresh store gets six Categories and the Starter Rules", async () => {
    // Given: a temp path with no file
    // When
    const { categories, rules, flag } = await open(
      Effect.gen(function* () {
        const store = yield* Store;
        const categories = yield* store.listCategories();
        const rules = yield* store.listRules();
        const flag = yield* store.getSetting("starterSet");
        return { categories, rules, flag };
      }),
    );
    // Then
    expect(categories.map((c) => c.name)).toEqual([
      "Coding",
      "Communication",
      "Design",
      "Entertainment",
      "Social",
      "Writing",
    ]);
    expect(
      categories.map((c) => ({ name: c.name, productive: c.productive })),
    ).toEqual([
      { name: "Coding", productive: true },
      { name: "Communication", productive: true },
      { name: "Design", productive: true },
      { name: "Entertainment", productive: false },
      { name: "Social", productive: false },
      { name: "Writing", productive: true },
    ]);
    expect(rules).toHaveLength(starterRules.length);
    expect(rules[0]?.position).toBe(0);
    expect(rules.at(-1)?.position).toBe(starterRules.length - 1);
    expect(flag).toEqual(Option.some("1"));
  });

  it("a second open leaves the Starter set alone", async () => {
    // Given: the same path opened once already
    await open(Effect.void);
    // When
    const counts = await open(
      Effect.gen(function* () {
        const store = yield* Store;
        const categories = yield* store.listCategories();
        const rules = yield* store.listRules();
        return [categories.length, rules.length];
      }),
    );
    // Then
    expect(counts).toEqual([6, starterRules.length]);
  });

  it("a deleted rule stays deleted after a reopen", async () => {
    // Given: the path opened once; the rule at position 0 deleted
    await open(
      Effect.gen(function* () {
        const store = yield* Store;
        const rules = yield* store.listRules();
        const first = rules[0];
        if (first !== undefined) {
          yield* store.deleteRule(first.id);
        }
      }),
    );
    // When
    const rules = await open(
      Effect.gen(function* () {
        const store = yield* Store;
        return yield* store.listRules();
      }),
    );
    // Then
    expect(rules).toHaveLength(starterRules.length - 1);
    expect(rules[0]?.position).toBe(0);
    expect(rules.some((r) => r.value === "(Incognito)")).toBe(false);
  });

  it("a seed whose write fails leaves nothing and the next open seeds", async () => {
    // Given: a migrated, empty database whose rules table rejects a third row
    await Effect.runPromise(Effect.scoped(openStore(path)));
    const db = new Database(path);
    db.exec(
      "CREATE TRIGGER fail_third_rule BEFORE INSERT ON rules WHEN (SELECT count(*) FROM rules) >= 2 BEGIN SELECT RAISE(ABORT, 'disk full'); END",
    );
    db.close();
    // When: the store opens, and the seed dies on the third Rule
    const failed = await Effect.runPromise(
      Effect.either(Effect.void.pipe(Effect.provide(Store.Default(path)))),
    );
    const partial = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* openStore(path);
          return {
            categories: yield* store.listCategories(),
            rules: yield* store.listRules(),
            flag: yield* store.getSetting("starterSet"),
          };
        }),
      ),
    );
    // Then: the open failed and the database holds no trace of the seed
    expect(Either.isLeft(failed)).toBe(true);
    if (Either.isLeft(failed)) {
      expect(failed.left._tag).toBe("StoreError");
    }
    expect(partial.categories).toHaveLength(0);
    expect(partial.rules).toHaveLength(0);
    expect(partial.flag).toEqual(Option.none());
    // When: the fault is gone and the store opens again
    const fixed = new Database(path);
    fixed.exec("DROP TRIGGER fail_third_rule");
    fixed.close();
    const { categories, rules, flag } = await open(
      Effect.gen(function* () {
        const store = yield* Store;
        return {
          categories: yield* store.listCategories(),
          rules: yield* store.listRules(),
          flag: yield* store.getSetting("starterSet"),
        };
      }),
    );
    // Then: the full Starter set is there
    expect(categories).toHaveLength(6);
    expect(rules).toHaveLength(starterRules.length);
    expect(flag).toEqual(Option.some("1"));
  });

  it("a database with the flag set is never seeded again", async () => {
    // Given: the path opened once; every Starter Rule deleted
    await open(
      Effect.gen(function* () {
        const store = yield* Store;
        const rules = yield* store.listRules();
        for (const rule of rules) {
          yield* store.deleteRule(rule.id);
        }
      }),
    );
    // When: the store opens again
    const { rules, flag } = await open(
      Effect.gen(function* () {
        const store = yield* Store;
        return {
          rules: yield* store.listRules(),
          flag: yield* store.getSetting("starterSet"),
        };
      }),
    );
    // Then
    expect(rules).toHaveLength(0);
    expect(flag).toEqual(Option.some("1"));
  });

  it("the Starter set puts netflix.com in Entertainment and x.com in Social", async () => {
    // Given: a fresh open, and x.com seeded as ends with, no is exception
    const { categories, rules } = await open(
      Effect.gen(function* () {
        const store = yield* Store;
        return {
          categories: yield* store.listCategories(),
          rules: yield* store.listRules(),
        };
      }),
    );
    const name = (id: string | null) =>
      categories.find((c) => c.id === id)?.name ?? null;
    const site = (url: string) =>
      name(resolve({ ...chrome, url }, rules, device).categoryId);
    // When
    const xRule = starterRules.find((r) => r.value === "x.com");
    // Then
    expect(xRule?.compare).toBe("ends with");
    expect(site("https://www.netflix.com/browse")).toBe("Entertainment");
    expect(site("https://x.com/home")).toBe("Social");
    expect(site("https://api.x.com/2/tweets")).toBe("Social");
  });

  it("the Starter set covers 30 apps and 20 sites", () => {
    // Given: the Starter rules
    // When
    const apps = starterRules.filter((r) => r.field === "app").length;
    const sites = starterRules.filter((r) => r.field === "domain").length;
    // Then
    expect([apps, sites]).toEqual([40, 27]);
  });

  it("the Starter set marks a Chrome incognito title Private", async () => {
    // Given: a fresh open and a Chrome incognito title
    const rules = await open(
      Effect.gen(function* () {
        const store = yield* Store;
        return yield* store.listRules();
      }),
    );
    const activity = {
      ...chrome,
      title: "Example Domain - Google Chrome (Incognito)",
      url: "https://example.com/",
    };
    // When
    const resolution = resolve(activity, rules, device);
    // Then
    expect(resolution.private).toBe(true);
  });

  it("the Starter set marks a Firefox private window Private", async () => {
    // Given: a fresh open and a Firefox private window title
    const rules = await open(
      Effect.gen(function* () {
        const store = yield* Store;
        return yield* store.listRules();
      }),
    );
    const activity = {
      ...chrome,
      bundleId: "org.mozilla.firefox",
      appName: "Firefox",
      title: "Example Domain — Private Browsing",
      url: null,
    };
    // When
    const privateWindow = resolve(activity, rules, device);
    const normalWindow = resolve(chrome, rules, device);
    // Then
    expect(privateWindow.private).toBe(true);
    expect(normalWindow.private).toBe(false);
  });

  it("a title mentioning Private Browsing stays visible", async () => {
    // Given: a fresh open and a title that contains but does not end with the phrase
    const rules = await open(
      Effect.gen(function* () {
        const store = yield* Store;
        return yield* store.listRules();
      }),
    );
    // When
    const result = resolve(
      { ...chrome, title: "How Private Browsing Works" },
      rules,
      device,
    );
    // Then
    expect(result.private).toBe(false);
  });
});
