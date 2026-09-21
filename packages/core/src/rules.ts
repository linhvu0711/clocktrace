import { Effect, type Schema } from "effect";
import type { ParseError } from "effect/ParseResult";

import type { NewActivity } from "./activity.js";
import {
  InvalidRuleError,
  RuleNotFoundError,
  type StoreError,
} from "./errors.js";
import { resolve } from "./matcher.js";
import { exceedsBacktrackBudget } from "./regex-budget.js";
import { NewRule, type Rule } from "./rule.js";
import { Store } from "./store.js";

export const RuleInput = NewRule.omit("position");

export const addRule = (
  input: RuleInput,
): Effect.Effect<Rule, InvalidRuleError | ParseError | StoreError, Store> =>
  Effect.gen(function* () {
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
    const rules = yield* store.listRules();
    const duplicate = rules.find(
      (row) =>
        row.field === input.field &&
        row.compare === input.compare &&
        row.value === input.value &&
        row.effect === input.effect &&
        row.target === target,
    );
    if (duplicate) {
      return duplicate;
    }
    return yield* store.insertRule({
      ...input,
      target,
      position: rules.length,
    });
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

export const applyPrivate = <A extends NewActivity>(
  activity: A,
): Effect.Effect<A, StoreError, Store> =>
  Effect.gen(function* () {
    const store = yield* Store;
    const rules = yield* store.listRules();
    const devices = yield* store.listDevices();
    const device = devices.find((d) => d.id === activity.deviceId) ?? null;
    return resolve(activity, rules, device).private
      ? { ...activity, title: null, url: null }
      : activity;
  });

export type RuleInput = Schema.Schema.Type<typeof RuleInput>;
