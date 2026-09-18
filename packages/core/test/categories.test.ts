import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";

import type { CategoryNotFoundError } from "../src/index.js";
import { openStore, Store, setCategory } from "../src/index.js";

const EmptyStore = Layer.scoped(
  Store,
  Effect.map(openStore(":memory:"), (shape) => new Store(shape)),
);

const useEmpty = <A, E>(effect: Effect.Effect<A, E, Store>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(EmptyStore)));

describe("categories", () => {
  it("setCategory without an id creates the Category", async () => {
    // Given: an empty store
    // When
    const { result, categories } = await useEmpty(
      Effect.gen(function* () {
        const store = yield* Store;
        const result = yield* setCategory({
          id: null,
          name: "Research",
          productive: true,
        });
        const categories = yield* store.listCategories();
        return { result, categories };
      }),
    );
    // Then
    expect(result.name).toBe("Research");
    expect(result.productive).toBe(true);
    expect(result.id).toHaveLength(36);
    expect(categories).toEqual([result]);
  });

  it("setCategory with an id updates name and flag", async () => {
    // Given: an empty store with one category
    const { inserted, result } = await useEmpty(
      Effect.gen(function* () {
        const store = yield* Store;
        const inserted = yield* store.insertCategory({
          name: "Social",
          productive: false,
        });
        // When
        const result = yield* setCategory({
          id: inserted.id,
          name: "Social media",
          productive: true,
        });
        return { inserted, result };
      }),
    );
    // Then
    expect(result).toEqual({
      id: inserted.id,
      name: "Social media",
      productive: true,
    });
  });

  it("setCategory with an unknown id fails naming the id", async () => {
    // Given: an empty store
    // When
    const result = await useEmpty(
      Effect.either(
        setCategory({
          id: "00000000-0000-4000-8000-000000000077",
          name: "X",
          productive: true,
        }),
      ),
    );
    // Then
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      const error = result.left as CategoryNotFoundError;
      expect(error._tag).toBe("CategoryNotFoundError");
      expect(error.message).toBe(
        "category 00000000-0000-4000-8000-000000000077 not found",
      );
    }
  });
});
