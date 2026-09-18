import { Schema } from "effect";

import type { NewActivity } from "./activity.js";
import type { Device } from "./device.js";
import type { Rule } from "./rule.js";

export const Resolution = Schema.Struct({
  categoryId: Schema.NullOr(Schema.String),
  projectId: Schema.NullOr(Schema.String),
  private: Schema.Boolean,
});

const compare = (rule: Rule, candidate: string): boolean => {
  switch (rule.compare) {
    case "is":
      return candidate.toLowerCase() === rule.value.toLowerCase();
    default:
      return false;
  }
};

const candidates = (
  rule: Rule,
  activity: NewActivity,
  device: Device | null,
): ReadonlyArray<string> => {
  switch (rule.field) {
    case "app":
      return [activity.bundleId, activity.appName];
    default:
      return [];
  }
};

const matches = (
  rule: Rule,
  activity: NewActivity,
  device: Device | null,
): boolean =>
  candidates(rule, activity, device).some((c) => compare(rule, c));

export const resolve = (
  activity: NewActivity,
  rules: ReadonlyArray<Rule>,
  device: Device | null,
): Resolution => {
  const sorted = [...rules].sort((a, b) => a.position - b.position);
  const first = (effect: Rule["effect"]) =>
    sorted.find((r) => r.effect === effect && matches(r, activity, device));
  return {
    categoryId: first("category")?.target ?? null,
    projectId: first("project")?.target ?? null,
    private: first("private") !== undefined,
  };
};

export type Resolution = Schema.Schema.Type<typeof Resolution>;
