import {
  addRule,
  type InvalidRuleError,
  type Rule,
  RuleCompare,
  RuleEffect,
  RuleField,
  type RuleInput,
  type RuleNotFoundError,
  removeRule,
  Store,
  type StoreError,
} from "@clocktrace/core";
import { Args, Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import type { ParseError } from "effect/ParseResult";

import { type Cell, columns, count, line, span, Style } from "./format.js";
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

const ruleWhen = (r: Rule): string =>
  `${r.field} ${r.compare} "${r.value}"`;

const ruleThen = (
  r: Rule,
  names: ReadonlyMap<string, string>,
): Cell =>
  r.effect === "private"
    ? span("warn", "private")
    : `${r.effect} ${names.get(r.target ?? "") ?? r.target}`;

const ruleRow = (
  r: Rule,
  names: ReadonlyMap<string, string>,
): ReadonlyArray<Cell> => [
  `  ${r.position}`,
  ruleWhen(r),
  ruleThen(r, names),
  span("dim", r.id),
];

const targetNames = (
  categories: ReadonlyArray<{ id: string; name: string }>,
  projects: ReadonlyArray<{ id: string; name: string }>,
): ReadonlyMap<string, string> =>
  new Map([...categories, ...projects].map((x) => [x.id, x.name] as const));

export const printRules = (
  json: boolean,
): Effect.Effect<void, StoreError, Store | Prompt | Style> =>
  Effect.gen(function* () {
    const store = yield* Store;
    const look = yield* Style;
    const [rules, categories, projects] = yield* Effect.all([
      store.listRules(),
      store.listCategories(),
      store.listProjects(),
    ]);
    const names = targetNames(categories, projects);
    const header = [
      span("dim", "  #"),
      span("dim", "when"),
      span("dim", "then"),
      span("dim", "id"),
    ];
    yield* report(json, { rules }, ({ rules }) =>
      rules.length === 0
        ? ["none"]
        : [
            ...columns(
              [header, ...rules.map((r) => ruleRow(r, names))],
              look,
            ),
            line(
              [span("dim", `  ${count(rules.length, "rule", "rules")}`)],
              look,
            ),
          ],
    );
  });

export const printAddedRule = (
  input: RuleInput,
  json: boolean,
): Effect.Effect<
  void,
  InvalidRuleError | ParseError | StoreError,
  Store | Prompt
> =>
  Effect.gen(function* () {
    const names: ReadonlyMap<string, string> = json
      ? new Map()
      : yield* Effect.flatMap(Store, (store) =>
          Effect.map(
            Effect.all([store.listCategories(), store.listProjects()]),
            ([categories, projects]) => targetNames(categories, projects),
          ),
        );
    const rule = yield* addRule(input);
    yield* report(json, rule, (r) => [ruleLine(r, names)]);
  });

export const printRemovedRule = (
  id: string,
  json: boolean,
): Effect.Effect<void, RuleNotFoundError | StoreError, Store | Prompt> =>
  Effect.andThen(
    removeRule(id),
    report(json, { removed: id }, ({ removed }) => [`removed ${removed}`]),
  );

const field = Options.choice("field", RuleField.literals).pipe(
  Options.withDescription("the Activity field to test"),
);
const compare = Options.choice("compare", RuleCompare.literals).pipe(
  Options.withDescription(
    'how to compare the field; quote a value that holds a space: --compare "ends with"',
  ),
);
const value = Options.text("value").pipe(
  Options.withDescription("the text to compare against"),
);
const effect = Options.choice("effect", RuleEffect.literals).pipe(
  Options.withDescription("what a matching Activity gets"),
);
const target = Options.text("target").pipe(
  Options.optional,
  Options.withDescription("the category or project id, for a set effect"),
);
const id = Args.text({ name: "id" });

const listCommand = Command.make("list", { json: jsonOption }, ({ json }) =>
  whenSetUp(printRules(json)),
);

const addCommand = Command.make(
  "add",
  { field, compare, value, effect, target, json: jsonOption },
  ({ json, target, ...rest }) =>
    whenSetUp(
      printAddedRule({ ...rest, target: Option.getOrNull(target) }, json),
    ),
);

const removeCommand = Command.make(
  "remove",
  { json: jsonOption, id },
  ({ id, json }) => whenSetUp(printRemovedRule(id, json)),
);

export const rulesCommand = Command.make("rules").pipe(
  Command.withDescription("list, add, or remove classification rules"),
  Command.withSubcommands([listCommand, addCommand, removeCommand]),
);
