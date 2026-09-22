import { Effect, Option, Schema } from "effect";
import type { ParseError } from "effect/ParseResult";

import { type Category, NewCategory } from "./category.js";
import {
  CategoryInUseError,
  CategoryNotFoundError,
  type StoreError,
} from "./errors.js";
import { Store } from "./store.js";

export const CategoryInput = Schema.Struct({
  id: Schema.NullOr(Schema.String),
  ...NewCategory.fields,
  productive: Schema.optional(Schema.Boolean),
});

export const setCategory = (
  input: CategoryInput,
): Effect.Effect<
  Category,
  CategoryNotFoundError | ParseError | StoreError,
  Store
> =>
  Effect.gen(function* () {
    const store = yield* Store;
    if (input.id === null) {
      return yield* store.insertCategory({
        name: input.name,
        productive: input.productive ?? false,
      });
    }
    let productive = input.productive;
    if (productive === undefined) {
      const categories = yield* store.listCategories();
      const current = categories.find((c) => c.id === input.id);
      if (current === undefined) {
        return yield* new CategoryNotFoundError({ id: input.id });
      }
      productive = current.productive;
    }
    const updated = yield* store.updateCategory(input.id, {
      name: input.name,
      productive,
    });
    if (Option.isNone(updated)) {
      return yield* new CategoryNotFoundError({ id: input.id });
    }
    return updated.value;
  });

export const removeCategory = (
  id: string,
): Effect.Effect<
  void,
  CategoryNotFoundError | CategoryInUseError | StoreError,
  Store
> =>
  Effect.gen(function* () {
    const store = yield* Store;
    const rules = yield* store.listRules();
    const count = rules.filter(
      (rule) => rule.effect === "category" && rule.target === id,
    ).length;
    if (count > 0) {
      return yield* new CategoryInUseError({ id, count });
    }
    const deleted = yield* store.deleteCategory(id);
    if (!deleted) {
      return yield* new CategoryNotFoundError({ id });
    }
  });

export type CategoryInput = Schema.Schema.Type<typeof CategoryInput>;
