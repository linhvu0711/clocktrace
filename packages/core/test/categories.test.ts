import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";

import type {
  CategoryInUseError,
  CategoryNotFoundError,
} from "../src/index.js";
import { openStore, removeCategory, Store, setCategory } from "../src/index.js";

const EmptyStore = Layer.scoped(
  Store,
  Effect.map(openStore(":memory:"), (shape) => new Store(shape)),
);

const useEmpty = <A, E>(effect: Effect.Effect<A, E, Store>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(EmptyStore)));

describe("categories", () => {
  it("removeCategory deletes the Category", async () => {
    // Given: an empty store with one category
    const categories = await useEmpty(
      Effect.gen(function* () {
        const store = yield* Store;
        const inserted = yield* store.insertCategory({
          name: "Social",
          productive: false,
        });
        // When
        yield* removeCategory(inserted.id);
        return yield* store.listCategories();
      }),
    );
    // Then
    expect(categories).toEqual([]);
  });

  it("removeCategory of an unknown id names the id", async () => {
    // Given: an empty store
    // When
    const result = await useEmpty(
      Effect.either(removeCategory("00000000-0000-4000-8000-000000000077")),
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

  it("removeCategory refuses while 3 Rules use it", async () => {
    // Given: an empty store with a Category three Rules point at
    const { id, result, categories } = await useEmpty(
      Effect.gen(function* () {
        const store = yield* Store;
        const cat = yield* store.insertCategory({
          name: "Coding",
          productive: true,
        });
        for (const [position, value] of ["a", "b", "c"].entries()) {
          yield* store.insertRule({
            position,
            field: "app",
            compare: "is",
            value,
            effect: "category",
            target: cat.id,
          });
        }
        // When
        const result = yield* Effect.either(removeCategory(cat.id));
        const categories = yield* store.listCategories();
        return { id: cat.id, result, categories };
      }),
    );
    // Then
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      const error = result.left as CategoryInUseError;
      expect(error._tag).toBe("CategoryInUseError");
      expect(error.message).toBe(
        `category ${id} is used by 3 rules, remove them first`,
      );
    }
    expect(categories).toHaveLength(1);
  });
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

  it("setCategory with an id and no flag keeps the flag", async () => {
    // Given: an empty store with one productive category
    const { inserted, result } = await useEmpty(
      Effect.gen(function* () {
        const store = yield* Store;
        const inserted = yield* store.insertCategory({
          name: "Coding",
          productive: true,
        });
        // When: a rename that leaves out productive
        const result = yield* setCategory({ id: inserted.id, name: "Code" });
        return { inserted, result };
      }),
    );
    // Then
    expect(result).toEqual({
      id: inserted.id,
      name: "Code",
      productive: true,
    });
  });

  it("setCategory with an unknown id and no flag names the id", async () => {
    // Given: an empty store
    // When: an update with no productive on an id that does not exist
    const result = await useEmpty(
      Effect.either(
        setCategory({
          id: "00000000-0000-4000-8000-000000000077",
          name: "X",
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
