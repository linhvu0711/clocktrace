import {
  type Category,
  type CategoryInput,
  type CategoryInUseError,
  type CategoryNotFoundError,
  removeCategory,
  Store,
  type StoreError,
  setCategory,
} from "@clocktrace/core";
import { Args, Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import type { ParseError } from "effect/ParseResult";

import { jsonOption, report } from "./output.js";
import type { Prompt } from "./prompt.js";
import { whenSetUp } from "./set-up.js";

export const categoryLine = (c: Category): string =>
  `${c.id}  ${c.name}  ${c.productive ? "productive" : "not productive"}`;

export const printCategories = (
  json: boolean,
): Effect.Effect<void, StoreError, Store | Prompt> =>
  Effect.gen(function* () {
    const store = yield* Store;
    const categories = yield* store.listCategories();
    yield* report(json, { categories }, ({ categories }) =>
      categories.length === 0 ? ["none"] : categories.map(categoryLine),
    );
  });

export const printSetCategory = (
  input: CategoryInput,
  json: boolean,
): Effect.Effect<
  void,
  CategoryNotFoundError | ParseError | StoreError,
  Store | Prompt
> =>
  Effect.gen(function* () {
    const c = yield* setCategory(input);
    yield* report(json, c, (c) => [categoryLine(c)]);
  });

export const printRemovedCategory = (
  id: string,
  json: boolean,
): Effect.Effect<
  void,
  CategoryNotFoundError | CategoryInUseError | StoreError,
  Store | Prompt
> =>
  Effect.andThen(
    removeCategory(id),
    report(json, { removed: id }, ({ removed }) => [`removed ${removed}`]),
  );

const id = Options.text("id").pipe(Options.optional);
const name = Options.text("name");
const productive = Options.boolean("productive");
const idArg = Args.text({ name: "id" });

const listCommand = Command.make("list", { json: jsonOption }, ({ json }) =>
  whenSetUp(printCategories(json)),
);

const setCommand = Command.make(
  "set",
  { id, name, productive, json: jsonOption },
  ({ id, json, ...rest }) =>
    whenSetUp(printSetCategory({ ...rest, id: Option.getOrNull(id) }, json)),
);

const removeCommand = Command.make(
  "remove",
  { json: jsonOption, id: idArg },
  ({ id, json }) => whenSetUp(printRemovedCategory(id, json)),
);

export const categoriesCommand = Command.make("categories").pipe(
  Command.withSubcommands([listCommand, setCommand, removeCommand]),
);
