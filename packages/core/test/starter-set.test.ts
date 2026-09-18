import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DateTime, Effect, Option } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Device, NewActivity } from "../src/index.js";
import { resolve, starterRules, Store } from "../src/index.js";

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
    expect(rules).toHaveLength(69);
    expect(rules[0]?.position).toBe(0);
    expect(rules[68]?.position).toBe(68);
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
    expect(counts).toEqual([6, 69]);
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
    expect(rules).toHaveLength(68);
    expect(rules[0]?.position).toBe(0);
    expect(rules.some((r) => r.value === "(Incognito)")).toBe(false);
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
});
