import {
  addRule,
  type CategoryInUseError,
  type CategoryNotFoundError,
  openStore,
  Store,
  setCategory,
} from "@clocktrace/core";
import { NodeContext } from "@effect/platform-node";
import { Console, Effect, Exit, Layer, type Scope } from "effect";
import { describe, expect, it } from "vitest";

import {
  printCategories,
  printRemovedCategory,
  printSetCategory,
} from "../src/categories.js";
import { Style } from "../src/format.js";
import { Prompt } from "../src/prompt.js";
import * as MockConsole from "./mock-console.js";
import * as MockTerminal from "./mock-terminal.js";

const EmptyStore = Layer.scoped(
  Store,
  Effect.map(openStore(":memory:"), (shape) => new Store(shape)),
);

const runPrint = <A, E, ELayer>(
  layer: Layer.Layer<Store, ELayer, Scope.Scope>,
  body: Effect.Effect<A, E, Store | Prompt | Style>,
  style: Layer.Layer<Style> = Style.Test,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const terminal = yield* MockTerminal.make(false);
      const console = yield* MockConsole.make;
      const exit = yield* Effect.exit(
        Effect.scoped(
          body.pipe(
            Effect.provide(
              Layer.mergeAll(
                Console.setConsole(console),
                NodeContext.layer,
                terminal.layer,
                Prompt.Default,
                layer,
                style,
              ),
            ),
          ),
        ),
      );
      const output = yield* console.getLines({ stripAnsi: true });
      return { exit, output };
    }),
  );

describe("categories", () => {
  it("list prints a header, one row per Category with the id last, and the count", async () => {
    // Given: two Categories, one productive and one not
    const { exit, output } = await runPrint(
      EmptyStore,
      Effect.gen(function* () {
        const coding = yield* setCategory({
          id: null,
          name: "Coding",
          productive: true,
        });
        const social = yield* setCategory({
          id: null,
          name: "Social",
          productive: false,
        });
        // When
        yield* printCategories(false);
        return { coding, social };
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const { coding, social } = exit.value;
      expect(output).toEqual([
        "  name    productive      id",
        `  Coding  productive      ${coding.id}`,
        `  Social  not productive  ${social.id}`,
        "  2 categories",
      ]);
    }
  });

  it("list on a narrow terminal prints the id whole", async () => {
    // Given: two Categories, a terminal 30 columns wide
    const { exit, output } = await runPrint(
      EmptyStore,
      Effect.gen(function* () {
        const coding = yield* setCategory({
          id: null,
          name: "Coding",
          productive: true,
        });
        const social = yield* setCategory({
          id: null,
          name: "Social",
          productive: false,
        });
        // When
        yield* printCategories(false);
        return { coding, social };
      }),
      Layer.succeed(
        Style,
        new Style({ color: false, unicode: true, width: 30 }),
      ),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const { coding, social } = exit.value;
      expect(output).toEqual([
        "  name    productive      id",
        `  Coding  productive      ${coding.id}`,
        `  Social  not productive  ${social.id}`,
        "  2 categories",
      ]);
    }
  });

  it("list --json prints the list_categories JSON", async () => {
    // Given: one Category
    const { exit, output } = await runPrint(
      EmptyStore,
      Effect.gen(function* () {
        const c = yield* setCategory({
          id: null,
          name: "Research",
          productive: true,
        });
        // When
        yield* printCategories(true);
        return c;
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const c = exit.value;
      expect(JSON.parse(output[0] ?? "")).toEqual({
        categories: [{ id: c.id, name: "Research", productive: true }],
      });
    }
  });

  it("list of no Categories prints none", async () => {
    // Given: an empty store
    // When
    const { exit, output } = await runPrint(EmptyStore, printCategories(false));
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual(["none"]);
  });

  it("set creates and prints it", async () => {
    // Given: an empty store
    const { exit, output } = await runPrint(
      EmptyStore,
      Effect.gen(function* () {
        const store = yield* Store;
        // When
        yield* printSetCategory(
          { id: null, name: "Research", productive: true },
          false,
        );
        return yield* store.listCategories();
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const categories = exit.value;
      expect(categories.length).toBe(1);
      expect(output).toEqual([
        `✔ created category Research  productive · ${categories[0]?.id}`,
      ]);
    }
  });

  it("set --id updates", async () => {
    // Given: a Category named Social, not productive
    const { exit, output } = await runPrint(
      EmptyStore,
      Effect.gen(function* () {
        const c = yield* setCategory({
          id: null,
          name: "Social",
          productive: false,
        });
        // When
        yield* printSetCategory(
          { id: c.id, name: "Social media", productive: true },
          true,
        );
        return c;
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(JSON.parse(output[0] ?? "")).toEqual({
        id: exit.value.id,
        name: "Social media",
        productive: true,
      });
    }
  });

  it("set --id keeps productive when the flag is omitted", async () => {
    // Given: a productive Category named Coding
    const { exit, output } = await runPrint(
      EmptyStore,
      Effect.gen(function* () {
        const c = yield* setCategory({
          id: null,
          name: "Coding",
          productive: true,
        });
        // When: a rename that leaves out productive, then list
        yield* printSetCategory({ id: c.id, name: "Code" }, false);
        yield* printCategories(false);
        return c;
      }),
    );
    // Then: set and list both show it still productive
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(output).toEqual([
        `✔ updated category Code  productive · ${exit.value.id}`,
        "  name  productive  id",
        `  Code  productive  ${exit.value.id}`,
        "  1 category",
      ]);
    }
  });

  it("set --id --productive false turns the flag off", async () => {
    // Given: a productive Category named Coding
    const { exit, output } = await runPrint(
      EmptyStore,
      Effect.gen(function* () {
        const c = yield* setCategory({
          id: null,
          name: "Coding",
          productive: true,
        });
        // When
        yield* printSetCategory(
          { id: c.id, name: "Code", productive: false },
          false,
        );
        return c;
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(output[0]).toBe(
        `✔ updated category Code  not productive · ${exit.value.id}`,
      );
    }
  });

  it("set with no id defaults to not productive and --productive true makes it productive", async () => {
    // Given: an empty store
    const { exit, output } = await runPrint(
      EmptyStore,
      Effect.gen(function* () {
        // When: a create with no flag, then a create with --productive true
        yield* printSetCategory({ id: null, name: "Reading" }, false);
        yield* printSetCategory(
          { id: null, name: "Focus", productive: true },
          false,
        );
        const store = yield* Store;
        return yield* store.listCategories();
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const categories = exit.value;
      const reading = categories.find((c) => c.name === "Reading");
      const focus = categories.find((c) => c.name === "Focus");
      expect(output).toEqual([
        `✔ created category Reading  not productive · ${reading?.id}`,
        `✔ created category Focus  productive · ${focus?.id}`,
      ]);
    }
  });

  it("set --id unknown with no flag names the id", async () => {
    // Given: an empty store
    // When: an update with no flag on an id that does not exist
    const { exit, output } = await runPrint(
      EmptyStore,
      printSetCategory(
        { id: "00000000-0000-4000-8000-000000000077", name: "X" },
        false,
      ),
    );
    // Then
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
      const error = exit.cause.error as CategoryNotFoundError;
      expect(error.message).toBe(
        "category 00000000-0000-4000-8000-000000000077 not found",
      );
    }
    expect(output).toEqual([]);
  });

  it("set with an unknown id names the id", async () => {
    // Given: an empty store
    // When
    const { exit, output } = await runPrint(
      EmptyStore,
      printSetCategory(
        {
          id: "00000000-0000-4000-8000-000000000077",
          name: "X",
          productive: true,
        },
        false,
      ),
    );
    // Then
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
      const error = exit.cause.error as CategoryNotFoundError;
      expect(error.message).toBe(
        "category 00000000-0000-4000-8000-000000000077 not found",
      );
    }
    expect(output).toEqual([]);
  });

  it("remove prints removed", async () => {
    // Given: one Category
    const { exit, output } = await runPrint(
      EmptyStore,
      Effect.gen(function* () {
        const store = yield* Store;
        const c = yield* setCategory({
          id: null,
          name: "Research",
          productive: true,
        });
        // When
        yield* printRemovedCategory(c.id, false);
        return { c, categories: yield* store.listCategories() };
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const { c, categories } = exit.value;
      expect(output).toEqual([`✔ removed category ${c.id}`]);
      expect(categories).toEqual([]);
    }
  });

  it("remove of a Category in use names the count", async () => {
    // Given: a Category with one Rule pointing at it
    const { exit, output } = await runPrint(
      EmptyStore,
      Effect.gen(function* () {
        const c = yield* setCategory({
          id: null,
          name: "Coding",
          productive: true,
        });
        yield* addRule({
          field: "domain",
          compare: "ends with",
          value: "github.com",
          effect: "category",
          target: c.id,
        });
        // When
        const removeExit = yield* Effect.exit(
          printRemovedCategory(c.id, false),
        );
        return { c, removeExit };
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const { c, removeExit } = exit.value;
      expect(Exit.isFailure(removeExit)).toBe(true);
      if (Exit.isFailure(removeExit) && removeExit.cause._tag === "Fail") {
        const error = removeExit.cause.error as CategoryInUseError;
        expect(error.message).toBe(
          `category ${c.id} is used by 1 rules, remove them first`,
        );
      }
    }
    expect(output).toEqual([]);
  });

  it("remove of an unknown id names the id", async () => {
    // Given: an empty store
    // When
    const { exit, output } = await runPrint(
      EmptyStore,
      printRemovedCategory("00000000-0000-4000-8000-000000000077", false),
    );
    // Then
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
      const error = exit.cause.error as CategoryNotFoundError;
      expect(error.message).toBe(
        "category 00000000-0000-4000-8000-000000000077 not found",
      );
    }
    expect(output).toEqual([]);
  });
});
