import { addRule, openStore, Store, setCategory } from "@clocktrace/core";
import { Effect, Exit, Layer, Ref } from "effect";
import { describe, expect, it } from "vitest";

import { fakePrompt, type Prompt } from "../src/prompt.js";
import { printRules } from "../src/rules.js";

const EmptyStore = Layer.scoped(
  Store,
  Effect.map(openStore(":memory:"), (shape) => new Store(shape)),
);

const runPrint = <A, E1, E2>(
  seed: Effect.Effect<A, E1, Store>,
  print: Effect.Effect<void, E2, Store | Prompt>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const prompt = yield* fakePrompt([], false);
      const exit = yield* Effect.exit(
        Effect.scoped(
          seed
            .pipe(Effect.flatMap((a) => Effect.as(print, a)))
            .pipe(Effect.provide(Layer.merge(prompt.layer, EmptyStore))),
        ),
      );
      const output = yield* Ref.get(prompt.output);
      return { exit, output };
    }),
  );

describe("rules", () => {
  it("list prints one line per Rule with the target name", async () => {
    // Given: two Rules, one private, one pointing at a Category
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const c = yield* setCategory({
          id: null,
          name: "Research",
          productive: true,
        });
        const r0 = yield* addRule({
          field: "title",
          compare: "ends with",
          value: "(Incognito)",
          effect: "private",
          target: null,
        });
        const r1 = yield* addRule({
          field: "domain",
          compare: "ends with",
          value: "github.com",
          effect: "category",
          target: c.id,
        });
        return { r0, r1 };
      }),
      printRules(false),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const { r0, r1 } = exit.value;
      expect(output).toEqual([
        `${r0.id}  0  title ends with (Incognito)  private`,
        `${r1.id}  1  domain ends with github.com  category Research`,
      ]);
    }
  });

  it("list --json prints the list_rules JSON", async () => {
    // Given: the same two Rules
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const c = yield* setCategory({
          id: null,
          name: "Research",
          productive: true,
        });
        const r0 = yield* addRule({
          field: "title",
          compare: "ends with",
          value: "(Incognito)",
          effect: "private",
          target: null,
        });
        const r1 = yield* addRule({
          field: "domain",
          compare: "ends with",
          value: "github.com",
          effect: "category",
          target: c.id,
        });
        return { c, r0, r1 };
      }),
      printRules(true),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output.length).toBe(1);
    if (Exit.isSuccess(exit)) {
      const { c, r0, r1 } = exit.value;
      expect(JSON.parse(output[0] ?? "")).toEqual({
        rules: [
          {
            id: r0.id,
            position: 0,
            field: "title",
            compare: "ends with",
            value: "(Incognito)",
            effect: "private",
            target: null,
          },
          {
            id: r1.id,
            position: 1,
            field: "domain",
            compare: "ends with",
            value: "github.com",
            effect: "category",
            target: c.id,
          },
        ],
      });
    }
  });

  it("list of no Rules prints none", async () => {
    // Given: an empty store
    const { exit, output } = await runPrint(Effect.void, printRules(false));
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual(["none"]);
  });
});
