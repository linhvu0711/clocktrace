import { Effect, Option, Schema } from "effect";
import type { ParseError } from "effect/ParseResult";

import { type Category, NewCategory } from "./category.js";
import { CategoryNotFoundError, type StoreError } from "./errors.js";
import { Store } from "./store.js";

export const CategoryInput = Schema.Struct({
  id: Schema.NullOr(Schema.String),
  ...NewCategory.fields,
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
        productive: input.productive,
      });
    }
    const updated = yield* store.updateCategory(input.id, {
      name: input.name,
      productive: input.productive,
    });
    if (Option.isNone(updated)) {
      return yield* new CategoryNotFoundError({ id: input.id });
    }
    return updated.value;
  });

export type CategoryInput = Schema.Schema.Type<typeof CategoryInput>;
