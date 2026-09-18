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

  it("is folds case", () => {
    // Given: a rule whose value is a different case than the bundle id
    const rules = [
      rule(0, "app", "is", "COM.GOOGLE.CHROME", "category", "cat-coding"),
    ];
    // When
    const resolution = resolve(chrome, rules, device);
    // Then
    expect(resolution.categoryId).toBe("cat-coding");
  });

  it("contains folds case", () => {
    // Given: a title rule with a lower-case value
    const rules = [
      rule(0, "title", "contains", "github", "category", "cat-coding"),
    ];
    // When
    const resolution = resolve(chrome, rules, device);
    // Then
    expect(resolution.categoryId).toBe("cat-coding");
  });

  it("starts with", () => {
    // Given: a url rule that matches and one that does not
    const rules = [
      rule(
        0,
        "url",
        "starts with",
        "https://github.com/",
        "project",
        "proj-clocktrace",
      ),
      rule(1, "url", "starts with", "github.com", "category", "cat-coding"),
    ];
    // When
    const resolution = resolve(chrome, rules, device);
    // Then
    expect(resolution).toEqual({
      categoryId: null,
      projectId: "proj-clocktrace",
      private: false,
    });
  });

  it("ends with folds case", () => {
    // Given: a title rule with an upper-case value
    const rules = [rule(0, "title", "ends with", "CHROME", "private", null)];
    // When
    const resolution = resolve(chrome, rules, device);
    // Then
    expect(resolution.private).toBe(true);
  });

  it("matches runs the value as a regex", () => {
    // Given: a domain regex that matches and a url regex that does not
    const rules = [
      rule(
        0,
        "domain",
        "matches",
        "^(www\\.)?github\\.com$",
        "category",
        "cat-coding",
      ),
      rule(1, "url", "matches", "^gitlab", "project", "proj-x"),
    ];
    // When
    const resolution = resolve(chrome, rules, device);
    // Then
    expect(resolution).toEqual({
      categoryId: "cat-coding",
      projectId: null,
      private: false,
    });
  });

  it("app matches the bundle id or the app name", () => {
    // Given: one rule on the app name and one on the bundle id
    const rules = [
      rule(0, "app", "is", "google chrome", "category", "cat-a"),
      rule(1, "app", "is", "com.google.Chrome", "project", "proj-a"),
    ];
    // When
    const resolution = resolve(chrome, rules, device);
    // Then
    expect(resolution).toEqual({
      categoryId: "cat-a",
      projectId: "proj-a",
      private: false,
    });
  });

  it("domain is the host of url", () => {
    // Given: an activity on www.youtube.com
    const activity = { ...chrome, url: "https://www.youtube.com/watch?v=1" };
    const rules = [
      rule(0, "domain", "is", "youtube.com", "category", "cat-wrong"),
      rule(1, "domain", "ends with", "youtube.com", "category", "cat-fun"),
      rule(2, "domain", "is", "www.youtube.com", "project", "proj-yt"),
    ];
    // When
    const resolution = resolve(activity, rules, device);
    // Then
    expect(resolution).toEqual({
      categoryId: "cat-fun",
      projectId: "proj-yt",
      private: false,
    });
  });

  it("device matches the kind or the name", () => {
    // Given: one rule on the device kind and one on the device name
    const rules = [
      rule(0, "device", "is", "mac", "category", "cat-mac"),
      rule(1, "device", "is", "studio", "project", "proj-studio"),
    ];
    // When
    const withDevice = resolve(chrome, rules, device);
    const withoutDevice = resolve(chrome, rules, null);
    // Then
    expect(withDevice).toEqual({
      categoryId: "cat-mac",
      projectId: "proj-studio",
      private: false,
    });
    expect(withoutDevice).toEqual({
      categoryId: null,
      projectId: null,
      private: false,
    });
  });

  it("a null title or url never matches", () => {
    // Given: an activity with no title and no url
    const activity = { ...chrome, title: null, url: null };
    const rules = [
      rule(0, "title", "contains", "a", "private", null),
      rule(1, "url", "contains", "a", "private", null),
      rule(2, "domain", "contains", "a", "private", null),
      rule(3, "title", "matches", ".*", "private", null),
    ];
    // When
    const resolution = resolve(activity, rules, device);
    // Then
    expect(resolution.private).toBe(false);
  });

  it("an invalid regex never matches", () => {
    // Given: a rule whose value is not a valid regex
    const rules = [rule(0, "title", "matches", "(", "private", null)];
    // When
    const resolution = resolve(chrome, rules, device);
    // Then
    expect(resolution.private).toBe(false);
  });
});
