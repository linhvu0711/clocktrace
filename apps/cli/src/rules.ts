import { type Rule, Store, type StoreError } from "@clocktrace/core";
import { Command } from "@effect/cli";
import { Effect } from "effect";

import { jsonOption, report } from "./output.js";
import type { Prompt } from "./prompt.js";
import { whenSetUp } from "./set-up.js";

export const ruleLine = (
  rule: Rule,
  names: ReadonlyMap<string, string>,
): string =>
  [
    rule.id,
    String(rule.position),
    `${rule.field} ${rule.compare} ${rule.value}`,
    rule.target === null
      ? rule.effect
      : `${rule.effect} ${names.get(rule.target) ?? rule.target}`,
  ].join("  ");

export const printRules = (
  json: boolean,
): Effect.Effect<void, StoreError, Store | Prompt> =>
  Effect.gen(function* () {
    const store = yield* Store;
    const [rules, categories, projects] = yield* Effect.all([
      store.listRules(),
      store.listCategories(),
      store.listProjects(),
    ]);
    const names = new Map(
      [...categories, ...projects].map((x) => [x.id, x.name] as const),
    );
    yield* report(json, { rules }, ({ rules }) =>
      rules.length === 0
        ? ["none"]
        : rules.map((rule) => ruleLine(rule, names)),
    );
  });

const listCommand = Command.make("list", { json: jsonOption }, ({ json }) =>
  whenSetUp(printRules(json)),
);

export const rulesCommand = Command.make("rules").pipe(
  Command.withSubcommands([listCommand]),
);
