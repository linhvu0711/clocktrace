import {
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
import { Prompt } from "../src/prompt.js";
import * as MockConsole from "./mock-console.js";
import * as MockTerminal from "./mock-terminal.js";

const EmptyStore = Layer.scoped(
  Store,
  Effect.map(openStore(":memory:"), (shape) => new Store(shape)),
);

const runPrint = <A, E, ELayer>(
  layer: Layer.Layer<Store, ELayer, Scope.Scope>,
  body: Effect.Effect<A, E, Store | Prompt>,
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
  it("list prints the Starter set", async () => {
    // Given: Store.Test seeded with the six Starter Categories
    // When
    const { exit, output } = await runPrint(Store.Test, printCategories(false));
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output.map((l) => l.slice(38))).toEqual([
      "Coding  productive",
      "Communication  productive",
      "Design  productive",
      "Entertainment  not productive",
      "Social  not productive",
      "Writing  productive",
    ]);
    for (const l of output) {
      expect(l.slice(0, 36)).toHaveLength(36);
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
      expect(output).toEqual([`${categories[0]?.id}  Research  productive`]);
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
      const line = `${exit.value.id}  Code  productive`;
      expect(output[0]).toBe(line);
      expect(output.slice(1)).toEqual([line]);
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
      expect(output[0]).toBe(`${exit.value.id}  Code  not productive`);
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
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output[0]?.slice(38)).toBe("Reading  not productive");
    expect(output[1]?.slice(38)).toBe("Focus  productive");
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
      expect(output).toEqual([`removed ${c.id}`]);
      expect(categories).toEqual([]);
    }
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
