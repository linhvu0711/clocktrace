import {
  addRule,
  InvalidRuleError,
  openStore,
  RuleNotFoundError,
  Store,
  setCategory,
} from "@clocktrace/core";
import { NodeContext } from "@effect/platform-node";
import { Console, Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { Prompt } from "../src/prompt.js";
import { printAddedRule, printRemovedRule, printRules } from "../src/rules.js";
import * as MockConsole from "./mock-console.js";
import * as MockTerminal from "./mock-terminal.js";

const EmptyStore = Layer.scoped(
  Store,
  Effect.map(openStore(":memory:"), (shape) => new Store(shape)),
);

const runPrint = <A, E>(body: Effect.Effect<A, E, Store | Prompt>) =>
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
                EmptyStore,
              ),
            ),
          ),
        ),
      );
      const output = yield* console.getLines({ stripAnsi: true });
      return { exit, output };
    }),
  );

const seedCategory = setCategory({
  id: null,
  name: "Research",
  productive: true,
});

const privateRule = {
  field: "title",
  compare: "ends with",
  value: "(Incognito)",
  effect: "private",
  target: null,
} as const;

describe("rules", () => {
  it("list prints one line per Rule with the target name", async () => {
    // Given: two Rules, one private, one pointing at a Category
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const c = yield* seedCategory;
        const r0 = yield* addRule(privateRule);
        const r1 = yield* addRule({
          field: "domain",
          compare: "ends with",
          value: "github.com",
          effect: "category",
          target: c.id,
        });
        // When
        yield* printRules(false);
        return { r0, r1 };
      }),
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
        const c = yield* seedCategory;
        const r0 = yield* addRule(privateRule);
        const r1 = yield* addRule({
          field: "domain",
          compare: "ends with",
          value: "github.com",
          effect: "category",
          target: c.id,
        });
        // When
        yield* printRules(true);
        return { c, r0, r1 };
      }),
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
    // When
    const { exit, output } = await runPrint(printRules(false));
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual(["none"]);
  });

  it("add appends the Rule and prints it", async () => {
    // Given: an empty store with one Category
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        const c = yield* seedCategory;
        // When
        yield* printAddedRule(
          {
            field: "domain",
            compare: "ends with",
            value: "github.com",
            effect: "category",
            target: c.id,
          },
          false,
        );
        return yield* store.listRules();
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const rules = exit.value;
      expect(rules.length).toBe(1);
      expect(output).toEqual([
        `${rules[0]?.id}  0  domain ends with github.com  category Research`,
      ]);
    }
  });

  it("add --json prints the Rule", async () => {
    // Given: an empty store
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        // When
        yield* printAddedRule(privateRule, true);
        return yield* store.listRules();
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const rules = exit.value;
      expect(JSON.parse(output[0] ?? "")).toEqual({
        id: rules[0]?.id,
        position: 0,
        field: "title",
        compare: "ends with",
        value: "(Incognito)",
        effect: "private",
        target: null,
      });
    }
  });

  it("add rejects a bad regex naming value", async () => {
    // Given: an empty store
    // When
    const { exit, output } = await runPrint(
      printAddedRule(
        {
          field: "title",
          compare: "matches",
          value: "(",
          effect: "private",
          target: null,
        },
        false,
      ),
    );
    // Then
    expect(exit).toEqual(
      Exit.fail(
        new InvalidRuleError({ field: "value", reason: "not a valid regex" }),
      ),
    );
    if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
      const error = exit.cause.error as InvalidRuleError;
      expect(error.message).toBe("value: not a valid regex");
    }
    expect(output).toEqual([]);
  });

  it("add rejects a category rule with no target naming target", async () => {
    // Given: an empty store
    // When
    const { exit, output } = await runPrint(
      printAddedRule(
        {
          field: "app",
          compare: "is",
          value: "x",
          effect: "category",
          target: null,
        },
        false,
      ),
    );
    // Then
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
      const error = exit.cause.error as InvalidRuleError;
      expect(error.message).toBe("target: a category rule needs a Category id");
    }
    expect(output).toEqual([]);
  });

  it("add rejects an unknown target naming target", async () => {
    // Given: an empty store
    // When
    const { exit, output } = await runPrint(
      printAddedRule(
        {
          field: "app",
          compare: "is",
          value: "x",
          effect: "category",
          target: "00000000-0000-4000-8000-000000000077",
        },
        false,
      ),
    );
    // Then
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
      const error = exit.cause.error as InvalidRuleError;
      expect(error.message).toBe(
        "target: no Category with id 00000000-0000-4000-8000-000000000077",
      );
    }
    expect(output).toEqual([]);
  });

  it("remove prints removed", async () => {
    // Given: one Rule
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        const r0 = yield* addRule(privateRule);
        // When
        yield* printRemovedRule(r0.id, false);
        return { r0, rules: yield* store.listRules() };
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const { r0, rules } = exit.value;
      expect(output).toEqual([`removed ${r0.id}`]);
      expect(rules).toEqual([]);
    }
  });

  it("remove --json prints removed", async () => {
    // Given: one Rule
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const r0 = yield* addRule(privateRule);
        // When
        yield* printRemovedRule(r0.id, true);
        return r0;
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(output).toEqual([`{"removed":"${exit.value.id}"}`]);
    }
  });

  it("remove of an unknown id names the id", async () => {
    // Given: an empty store
    // When
    const { exit, output } = await runPrint(
      printRemovedRule("00000000-0000-4000-8000-000000000099", false),
    );
    // Then
    expect(exit).toEqual(
      Exit.fail(
        new RuleNotFoundError({
          id: "00000000-0000-4000-8000-000000000099",
        }),
      ),
    );
    if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
      const error = exit.cause.error as RuleNotFoundError;
      expect(error.message).toBe(
        "rule 00000000-0000-4000-8000-000000000099 not found",
      );
    }
    expect(output).toEqual([]);
  });
});
