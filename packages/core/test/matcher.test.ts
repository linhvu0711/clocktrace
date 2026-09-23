import { DateTime } from "effect";
import { describe, expect, it } from "vitest";

import type { Category, Device, NewActivity, Rule } from "../src/index.js";
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

  it("an app rule on the name matches an Activity with a Stand-in id", () => {
    // Given: a Wine game with a Stand-in id and a rule on its name
    const game: NewActivity = {
      ...chrome,
      bundleId: "noid:QSanguosha.exe",
      appName: "QSanguosha.exe",
      title: null,
      url: null,
    };
    const rules = [
      rule(0, "app", "is", "QSanguosha.exe", "category", "cat-games"),
    ];
    // When
    const resolution = resolve(game, rules, device);
    // Then
    expect(resolution).toEqual({
      categoryId: "cat-games",
      projectId: null,
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

  it("domain ends with covers the domain and its subdomains only", () => {
    // Given: a domain rule on github.com and three hosts
    const rules = [
      rule(0, "domain", "ends with", "github.com", "category", "cat-coding"),
    ];
    const host = (url: string) => resolve({ ...chrome, url }, rules, device);
    // When
    const root = host("https://github.com/x");
    const sub = host("https://api.github.com/x");
    const sibling = host("https://evilgithub.com/x");
    // Then
    expect(root.categoryId).toBe("cat-coding");
    expect(sub.categoryId).toBe("cat-coding");
    expect(sibling.categoryId).toBeNull();
  });

  it("domain starts with covers a leading label only", () => {
    // Given: a domain rule on docs and two hosts
    const rules = [
      rule(0, "domain", "starts with", "docs", "category", "cat-writing"),
    ];
    const host = (url: string) => resolve({ ...chrome, url }, rules, device);
    // When
    const label = host("https://docs.google.com/x");
    const sibling = host("https://docsevil.com/x");
    // Then
    expect(label.categoryId).toBe("cat-writing");
    expect(sibling.categoryId).toBeNull();
  });

  it("domain ends with a leading dot behaves like no dot", () => {
    // Given: a domain rule whose value is .github.com
    const rules = [
      rule(0, "domain", "ends with", ".github.com", "category", "cat-coding"),
    ];
    const host = (url: string) => resolve({ ...chrome, url }, rules, device);
    // When
    const root = host("https://github.com/x");
    const sub = host("https://api.github.com/x");
    const sibling = host("https://evilgithub.com/x");
    // Then
    expect(root.categoryId).toBe("cat-coding");
    expect(sub.categoryId).toBe("cat-coding");
    expect(sibling.categoryId).toBeNull();
  });

  it("domain starts with a trailing dot behaves like no dot", () => {
    // Given: a domain rule whose value is docs.
    const rules = [
      rule(0, "domain", "starts with", "docs.", "category", "cat-writing"),
    ];
    // When
    const resolution = resolve(
      { ...chrome, url: "https://docs.google.com/x" },
      rules,
      device,
    );
    // Then
    expect(resolution.categoryId).toBe("cat-writing");
  });

  it("domain is with a leading dot never matches", () => {
    // Given: a domain rule with is and a leading dot
    const rules = [
      rule(0, "domain", "is", ".github.com", "category", "cat-coding"),
    ];
    // When
    const resolution = resolve(chrome, rules, device);
    // Then
    expect(resolution.categoryId).toBeNull();
  });

  it("title and url keep the plain text check", () => {
    // Given: title and url rules whose values do not sit at a dot
    const rules = [
      rule(0, "title", "ends with", "(Incognito)", "private", null),
      rule(1, "url", "ends with", "clocktrace", "category", "cat-coding"),
      rule(2, "url", "starts with", "https://git", "project", "proj-x"),
    ];
    const activity = { ...chrome, title: "Example - Chrome (Incognito)" };
    // When
    const resolution = resolve(activity, rules, device);
    // Then
    expect(resolution).toEqual({
      categoryId: "cat-coding",
      projectId: "proj-x",
      private: true,
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

  it("a genre lands in its Category when no Rule matches", () => {
    // Given: a Social category and the Social Networking genre
    const social: Category = {
      id: "00000000-0000-4000-8000-0000000000aa",
      name: "Social",
      productive: false,
    };
    // When
    const resolution = resolve(chrome, [], device, "Social Networking", [
      social,
    ]);
    // Then
    expect(resolution.categoryId).toBe(social.id);
  });

  it("a Rule still wins over the genre", () => {
    // Given: a Rule pointing at Coding and a Social Networking genre
    const coding: Category = {
      id: "00000000-0000-4000-8000-0000000000bb",
      name: "Coding",
      productive: true,
    };
    const social: Category = {
      id: "00000000-0000-4000-8000-0000000000aa",
      name: "Social",
      productive: false,
    };
    const rules = [
      rule(0, "app", "is", "com.google.Chrome", "category", coding.id),
    ];
    // When
    const resolution = resolve(chrome, rules, device, "Social Networking", [
      coding,
      social,
    ]);
    // Then
    expect(resolution.categoryId).toBe(coding.id);
  });

  it("an unknown genre leaves categoryId null", () => {
    // Given: a genre outside the map
    const social: Category = {
      id: "00000000-0000-4000-8000-0000000000aa",
      name: "Social",
      productive: false,
    };
    // When
    const resolution = resolve(chrome, [], device, "Utilities", [social]);
    // Then
    expect(resolution.categoryId).toBeNull();
  });

  it("a null genre leaves categoryId null", () => {
    // Given: no genre
    const social: Category = {
      id: "00000000-0000-4000-8000-0000000000aa",
      name: "Social",
      productive: false,
    };
    // When
    const resolution = resolve(chrome, [], device, null, [social]);
    // Then
    expect(resolution.categoryId).toBeNull();
  });
});
