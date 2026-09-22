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

import {
  type Cell,
  columns,
  count,
  type Look,
  line,
  mark,
  Style,
  span,
  text,
} from "./format.js";
import { jsonOption, report } from "./output.js";
import type { Prompt } from "./prompt.js";
import { whenSetUp } from "./set-up.js";

const categoryRow = (c: Category): ReadonlyArray<Cell> => [
  `  ${text(c.name)}`,
  c.productive ? "productive" : "not productive",
  span("dim", c.id),
];

export const printCategories = (
  json: boolean,
): Effect.Effect<void, StoreError, Store | Prompt | Style> =>
  Effect.gen(function* () {
    const store = yield* Store;
    const look: Look = json
      ? { color: false, unicode: true, width: 0 }
      : yield* Style;
    const categories = yield* store.listCategories();
    const header = [
      span("dim", "  name"),
      span("dim", "productive"),
      span("dim", "id"),
    ];
    yield* report(json, { categories }, ({ categories }) =>
      categories.length === 0
        ? ["none"]
        : [
            ...columns([header, ...categories.map(categoryRow)], look),
            line(
              [
                span(
                  "dim",
                  `  ${count(categories.length, "category", "categories")}`,
                ),
              ],
              look,
            ),
          ],
    );
  });

export const printSetCategory = (
  input: CategoryInput,
  json: boolean,
): Effect.Effect<
  void,
  CategoryNotFoundError | ParseError | StoreError,
  Store | Prompt | Style
> =>
  Effect.gen(function* () {
    const look: Look = json
      ? { color: false, unicode: true, width: 0 }
      : yield* Style;
    const c = yield* setCategory(input);
    const verb = input.id === null ? "created" : "updated";
    yield* report(json, c, (c) => [
      line(
        [
          mark("ok", look),
          ` ${verb} category ${text(c.name)}  `,
          span(
            "dim",
            `${c.productive ? "productive" : "not productive"} · ${c.id}`,
          ),
        ],
        look,
      ),
    ]);
  });

export const printRemovedCategory = (
  id: string,
  json: boolean,
): Effect.Effect<
  void,
  CategoryNotFoundError | CategoryInUseError | StoreError,
  Store | Prompt | Style
> =>
  Effect.gen(function* () {
    const look: Look = json
      ? { color: false, unicode: true, width: 0 }
      : yield* Style;
    yield* removeCategory(id);
    yield* report(json, { removed: id }, ({ removed }) => [
      line([mark("ok", look), ` removed category ${removed}`], look),
    ]);
  });

const id = Options.text("id").pipe(
  Options.optional,
  Options.withDescription("the category id to update; omit to create"),
);
const name = Options.text("name").pipe(
  Options.withDescription("the category name"),
);
const productive = Options.choice("productive", ["true", "false"]).pipe(
  Options.optional,
  Options.withDescription(
    "true or false; on an update, leaving it out keeps the current value",
  ),
);
const idArg = Args.text({ name: "id" });

const listCommand = Command.make("list", { json: jsonOption }, ({ json }) =>
  whenSetUp(printCategories(json)),
);

const setCommand = Command.make(
  "set",
  { id, name, productive, json: jsonOption },
  ({ id, name, productive, json }) =>
    whenSetUp(
      printSetCategory(
        {
          id: Option.getOrNull(id),
          name,
          productive: Option.getOrUndefined(
            Option.map(productive, (p) => p === "true"),
          ),
        },
        json,
      ),
    ),
);

const removeCommand = Command.make(
  "remove",
  { json: jsonOption, id: idArg },
  ({ id, json }) => whenSetUp(printRemovedCategory(id, json)),
);

export const categoriesCommand = Command.make("categories").pipe(
  Command.withDescription("list, set, or remove categories"),
  Command.withSubcommands([listCommand, setCommand, removeCommand]),
);
