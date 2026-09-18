import { Schema } from "effect";

import type { NewActivity } from "./activity.js";
import type { Device } from "./device.js";
import type { Rule } from "./rule.js";

export const Resolution = Schema.Struct({
  categoryId: Schema.NullOr(Schema.String),
  projectId: Schema.NullOr(Schema.String),
  private: Schema.Boolean,
});

// A domain compare stops at a dot: `ends with github.com` covers
// `github.com` and `api.github.com`, never `evilgithub.com` (ADR 0005).
const endsWithLabel = (host: string, value: string): boolean => {
  const suffix = value.startsWith(".") ? value.slice(1) : value;
  return host === suffix || host.endsWith(`.${suffix}`);
};

const startsWithLabel = (host: string, value: string): boolean => {
  const prefix = value.endsWith(".") ? value.slice(0, -1) : value;
  return host === prefix || host.startsWith(`${prefix}.`);
};

const compare = (rule: Rule, candidate: string): boolean => {
  const value = rule.value.toLowerCase();
  const c = candidate.toLowerCase();
  switch (rule.compare) {
    case "is":
      return c === value;
    case "contains":
      return c.includes(value);
    case "starts with":
      return rule.field === "domain"
        ? startsWithLabel(c, value)
        : c.startsWith(value);
    case "ends with":
      return rule.field === "domain"
        ? endsWithLabel(c, value)
        : c.endsWith(value);
    case "matches":
      try {
        return new RegExp(rule.value, "i").test(candidate);
      } catch {
        return false;
      }
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
    case "title":
      return activity.title === null ? [] : [activity.title];
    case "url":
      return activity.url === null ? [] : [activity.url];
    case "domain": {
      if (activity.url === null) {
        return [];
      }
      try {
        return [new URL(activity.url).hostname];
      } catch {
        return [];
      }
    }
    case "device":
      return device === null ? [] : [device.kind, device.name];
  }
};

const matches = (
  rule: Rule,
  activity: NewActivity,
  device: Device | null,
): boolean => candidates(rule, activity, device).some((c) => compare(rule, c));

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
