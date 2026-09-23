import { Effect, Schema } from "effect";
import type { ParseError } from "effect/ParseResult";

import type { NewActivity } from "./activity.js";
import {
  type InvalidInputError,
  InvalidRuleError,
  RuleNotFoundError,
  type StoreError,
} from "./errors.js";
import { decodeInput } from "./input.js";
import { resolve } from "./matcher.js";
import { exceedsBacktrackBudget } from "./regex-budget.js";
import { NewRule, type Rule } from "./rule.js";
import { Store } from "./store.js";

export const RuleInput = Schema.Struct({
  ...NewRule.omit("position").fields,
  target: Schema.optionalWith(Schema.NullOr(Schema.String), {
    default: () => null,
  }),
});

export const addRule = (
  encoded: Schema.Schema.Encoded<typeof RuleInput>,
): Effect.Effect<
  Rule,
  InvalidInputError | InvalidRuleError | ParseError | StoreError,
  Store
> =>
  Effect.gen(function* () {
    const input = yield* decodeInput(RuleInput)(encoded);
    const store = yield* Store;
    if (input.compare === "matches") {
      try {
        new RegExp(input.value);
      } catch {
        return yield* new InvalidRuleError({
          field: "value",
          reason: "not a valid regex",
        });
      }
      if (exceedsBacktrackBudget(input.value)) {
        return yield* new InvalidRuleError({
          field: "value",
          reason: "regex can backtrack catastrophically",
        });
      }
    }
    let target = input.target;
    if (input.effect === "private") {
      target = null;
    } else {
      const noun = input.effect === "category" ? "Category" : "Project";
      if (target === null) {
        return yield* new InvalidRuleError({
          field: "target",
          reason: `a ${input.effect} rule needs a ${noun} id`,
        });
      }
      const existing =
        input.effect === "category"
          ? yield* store.listCategories()
          : yield* store.listProjects();
      if (!existing.some((row) => row.id === target)) {
        return yield* new InvalidRuleError({
          field: "target",
          reason: `no ${noun} with id ${target}`,
        });
      }
    }
    return yield* store.insertRuleIfAbsent({ ...input, target });
  });

export const removeRule = (
  id: string,
): Effect.Effect<void, RuleNotFoundError | StoreError, Store> =>
  Effect.gen(function* () {
    const store = yield* Store;
    const removed = yield* store.deleteRule(id);
    if (!removed) {
      return yield* new RuleNotFoundError({ id });
    }
  });

export const readPrivate: Effect.Effect<
  (activity: NewActivity) => NewActivity,
  StoreError,
  Store
> = Effect.gen(function* () {
  const store = yield* Store;
  const rules = yield* store.listRules();
  const devices = yield* store.listDevices();
  return (activity) => {
    const device = devices.find((d) => d.id === activity.deviceId) ?? null;
    return resolve(activity, rules, device).private
      ? { ...activity, title: null, url: null }
      : activity;
  };
});

export type RuleInput = Schema.Schema.Type<typeof RuleInput>;
