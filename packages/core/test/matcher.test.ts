import { DateTime } from "effect";
import { describe, expect, it } from "vitest";

import type { Device, NewActivity, Rule } from "../src/index.js";
import { resolve } from "../src/index.js";

const deviceId = "00000000-0000-4000-8000-000000000001";
const device: Device = {
  id: deviceId,
  kind: "mac",
  name: "Studio",
  externalId: "mac-1",
};
const chrome: NewActivity = {
  deviceId,
  bundleId: "com.google.Chrome",
  appName: "Google Chrome",
  title: "GitHub - Google Chrome",
  url: "https://github.com/linhvu0711/clocktrace",
  startedAt: DateTime.unsafeMake("2026-09-17T10:00:00.000Z"),
  endedAt: DateTime.unsafeMake("2026-09-17T10:30:00.000Z"),
};
const rule = (
  position: number,
  field: Rule["field"],
  compare: Rule["compare"],
  value: string,
  effect: Rule["effect"],
  target: string | null,
): Rule => ({
  id: `00000000-0000-4000-8000-0000000000${String(position).padStart(2, "0")}`,
  position,
  field,
  compare,
  value,
  effect,
  target,
});

describe("matcher", () => {
  it("returns null for every effect when no rule matches", () => {
    // Given: one rule that does not match the activity
    const rules = [
      rule(0, "app", "is", "com.apple.Terminal", "category", "cat-coding"),
    ];
    // When
    const resolution = resolve(chrome, rules, device);
    // Then
    expect(resolution).toEqual({
      categoryId: null,
      projectId: null,
      private: false,
    });
  });

  it("first match by position wins per effect", () => {
    // Given: four matching rules in position order
    const rules = [
      rule(0, "app", "is", "com.google.Chrome", "category", "cat-browsing"),
      rule(1, "app", "is", "com.google.Chrome", "category", "cat-coding"),
      rule(2, "app", "is", "google chrome", "project", "proj-clocktrace"),
      rule(3, "app", "is", "com.google.Chrome", "private", null),
    ];
    // When
    const resolution = resolve(chrome, rules, device);
    // Then
    expect(resolution).toEqual({
      categoryId: "cat-browsing",
      projectId: "proj-clocktrace",
      private: true,
    });
  });

  it("the rule order given does not matter, position does", () => {
    // Given: the same four rules, passed in array order 3, 1, 2, 0
    const rules = [
      rule(3, "app", "is", "com.google.Chrome", "private", null),
      rule(1, "app", "is", "com.google.Chrome", "category", "cat-coding"),
      rule(2, "app", "is", "google chrome", "project", "proj-clocktrace"),
      rule(0, "app", "is", "com.google.Chrome", "category", "cat-browsing"),
    ];
    // When
    const resolution = resolve(chrome, rules, device);
    // Then
    expect(resolution).toEqual({
      categoryId: "cat-browsing",
      projectId: "proj-clocktrace",
      private: true,
    });
  });
});
