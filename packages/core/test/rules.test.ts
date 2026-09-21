import { DateTime, Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";

import type {
  InvalidRuleError,
  NewActivity,
  RuleNotFoundError,
} from "../src/index.js";
import {
  addRule,
  applyPrivate,
  openStore,
  removeRule,
  Store,
} from "../src/index.js";

const EmptyStore = Layer.scoped(
  Store,
  Effect.map(openStore(":memory:"), (shape) => new Store(shape)),
);

const useEmpty = <A, E>(effect: Effect.Effect<A, E, Store>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(EmptyStore)));

const useTest = <A, E>(effect: Effect.Effect<A, E, Store>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(Store.Test)));

const deviceId = "00000000-0000-4000-8000-000000000001";
const chrome: NewActivity = {
  deviceId,
  bundleId: "com.google.Chrome",
  appName: "Google Chrome",
  title: "GitHub - Google Chrome",
  url: "https://github.com/linhvu0711/clocktrace",
  startedAt: DateTime.unsafeMake("2026-09-17T10:00:00.000Z"),
  endedAt: DateTime.unsafeMake("2026-09-17T10:30:00.000Z"),
};

describe("rules", () => {
  it("addRule appends at the last position", async () => {
    // Given: an empty store with one category
    const { a, b, ids } = await useEmpty(
      Effect.gen(function* () {
        const store = yield* Store;
        const c = yield* store.insertCategory({
          name: "Coding",
          productive: true,
        });
        // When
        const a = yield* addRule({
          field: "app",
          compare: "is",
          value: "com.apple.Terminal",
          effect: "category",
          target: c.id,
        });
        const b = yield* addRule({
          field: "title",
          compare: "ends with",
          value: "(Incognito)",
          effect: "private",
          target: "ignored",
        });
        const ids = (yield* store.listRules()).map((r) => r.id);
        return { a, b, ids };
      }),
    );
    // Then
    expect(a.position).toBe(0);
    expect(b.position).toBe(1);
    expect(b.target).toBeNull();
    expect(ids).toEqual([a.id, b.id]);
  });

  it("addRule returns the existing rule instead of a duplicate", async () => {
    // Given: an empty store with one category and a rule added twice
    const { a, b, ids } = await useEmpty(
      Effect.gen(function* () {
        const store = yield* Store;
        const c = yield* store.insertCategory({
          name: "Work",
          productive: true,
        });
        const rule = {
          field: "domain",
          compare: "is",
          value: "github.com",
          effect: "category",
          target: c.id,
        } as const;
        // When
        const a = yield* addRule(rule);
        const b = yield* addRule(rule);
        const ids = (yield* store.listRules()).map((r) => r.id);
        return { a, b, ids };
      }),
    );
    // Then
    expect(a.position).toBe(0);
    expect(b.position).toBe(0);
    expect(b.id).toBe(a.id);
    expect(ids).toEqual([a.id]);
  });

  it("addRule adds a rule that differs in one field", async () => {
    // Given: an empty store with one category and two rules that differ in value
    const { a, b, ids } = await useEmpty(
      Effect.gen(function* () {
        const store = yield* Store;
        const c = yield* store.insertCategory({
          name: "Work",
          productive: true,
        });
        // When
        const a = yield* addRule({
          field: "domain",
          compare: "is",
          value: "github.com",
          effect: "category",
          target: c.id,
        });
        const b = yield* addRule({
          field: "domain",
          compare: "is",
          value: "gitlab.com",
          effect: "category",
          target: c.id,
        });
        const ids = (yield* store.listRules()).map((r) => r.id);
        return { a, b, ids };
      }),
    );
    // Then
    expect(a.position).toBe(0);
    expect(b.position).toBe(1);
    expect(b.id).not.toBe(a.id);
    expect(ids).toEqual([a.id, b.id]);
  });

  it("removeRule removes the rule and keeps positions dense", async () => {
    // Given: three private rules added with addRule
    const remaining = await useEmpty(
      Effect.gen(function* () {
        const store = yield* Store;
        const add = (value: string) =>
          addRule({
            field: "title",
            compare: "ends with",
            value,
            effect: "private",
            target: null,
          });
        yield* add("a");
        const b = yield* add("b");
        yield* add("c");
        // When
        yield* removeRule(b.id);
        return yield* store.listRules();
      }),
    );
    // Then
    expect(remaining.map((r) => [r.position, r.value])).toEqual([
      [0, "a"],
      [1, "c"],
    ]);
  });

  it("removeRule of an unknown id fails naming the id", async () => {
    // Given: an empty store
    // When
    const result = await useEmpty(
      Effect.either(removeRule("00000000-0000-4000-8000-000000000099")),
    );
    // Then
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      const error = result.left as RuleNotFoundError;
      expect(error._tag).toBe("RuleNotFoundError");
      expect(error.message).toBe(
        "rule 00000000-0000-4000-8000-000000000099 not found",
      );
    }
  });

  it("rejects an invalid regex naming value", async () => {
    // Given: an empty store
    // When
    const { result, rules } = await useEmpty(
      Effect.gen(function* () {
        const store = yield* Store;
        const result = yield* Effect.either(
          addRule({
            field: "title",
            compare: "matches",
            value: "(",
            effect: "private",
            target: null,
          }),
        );
        const rules = yield* store.listRules();
        return { result, rules };
      }),
    );
    // Then
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      const error = result.left as InvalidRuleError;
      expect(error._tag).toBe("InvalidRuleError");
      expect(error.field).toBe("value");
      expect(error.message).toBe("value: not a valid regex");
    }
    expect(rules).toEqual([]);
  });

  it("rejects a regex that can backtrack catastrophically naming value", async () => {
    // Given: an empty store
    // When
    const { result, rules } = await useEmpty(
      Effect.gen(function* () {
        const store = yield* Store;
        const result = yield* Effect.either(
          addRule({
            field: "title",
            compare: "matches",
            value: "(a+)+$",
            effect: "private",
            target: null,
          }),
        );
        const rules = yield* store.listRules();
        return { result, rules };
      }),
    );
    // Then
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      const error = result.left as InvalidRuleError;
      expect(error._tag).toBe("InvalidRuleError");
      expect(error.field).toBe("value");
      expect(error.message).toBe("value: regex can backtrack catastrophically");
    }
    expect(rules).toEqual([]);
  });

  it("rejects an unknown category target naming target", async () => {
    // Given: an empty store with no categories
    // When
    const result = await useEmpty(
      Effect.either(
        addRule({
          field: "app",
          compare: "is",
          value: "x",
          effect: "category",
          target: "00000000-0000-4000-8000-000000000077",
        }),
      ),
    );
    // Then
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      const error = result.left as InvalidRuleError;
      expect(error._tag).toBe("InvalidRuleError");
      expect(error.field).toBe("target");
      expect(error.message).toBe(
        "target: no Category with id 00000000-0000-4000-8000-000000000077",
      );
    }
  });

  it("rejects an unknown project target naming target", async () => {
    // Given: an empty store with one project
    const result = await useEmpty(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* store.insertProject({ name: "Thesis" });
        // When
        return yield* Effect.either(
          addRule({
            field: "app",
            compare: "is",
            value: "x",
            effect: "project",
            target: "00000000-0000-4000-8000-000000000077",
          }),
        );
      }),
    );
    // Then
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      const error = result.left as InvalidRuleError;
      expect(error.field).toBe("target");
      expect(error.message).toBe(
        "target: no Project with id 00000000-0000-4000-8000-000000000077",
      );
    }
  });

  it("rejects a category rule with no target naming target", async () => {
    // Given: an empty store
    // When
    const result = await useEmpty(
      Effect.either(
        addRule({
          field: "app",
          compare: "is",
          value: "x",
          effect: "category",
          target: null,
        }),
      ),
    );
    // Then
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      const error = result.left as InvalidRuleError;
      expect(error.field).toBe("target");
      expect(error.message).toBe("target: a category rule needs a Category id");
    }
  });

  it("applyPrivate blanks title and url on a Private match", async () => {
    // Given: Store.Test seeded with the Starter set, a device, an incognito title
    const result = await useTest(
      Effect.gen(function* () {
        const store = yield* Store;
        const d = yield* store.getOrInsertDevice({
          kind: "mac",
          name: "Studio",
          externalId: "mac-1",
        });
        const activity = {
          ...chrome,
          deviceId: d.id,
          title: "Example Domain - Google Chrome (Incognito)",
          url: "https://example.com/",
        };
        // When
        const blanked = yield* applyPrivate(activity);
        return { activity, blanked };
      }),
    );
    // Then
    expect(result.blanked).toEqual({
      ...result.activity,
      title: null,
      url: null,
    });
  });

  it("applyPrivate returns the activity unchanged when no Private rule matches", async () => {
    // Given: Store.Test, the same device, a normal title
    const result = await useTest(
      Effect.gen(function* () {
        const store = yield* Store;
        const d = yield* store.getOrInsertDevice({
          kind: "mac",
          name: "Studio",
          externalId: "mac-1",
        });
        const activity = { ...chrome, deviceId: d.id };
        // When
        const unchanged = yield* applyPrivate(activity);
        return { activity, unchanged };
      }),
    );
    // Then
    expect(result.unchanged).toEqual(result.activity);
  });
});
