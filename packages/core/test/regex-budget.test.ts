import { describe, expect, it } from "vitest";

import { exceedsBacktrackBudget } from "../src/index.js";

describe("regex-budget", () => {
  it("(a+)+$ exceeds the budget", () => {
    // Given: a nested-quantifier pattern
    // When / Then
    expect(exceedsBacktrackBudget("(a+)+$")).toBe(true);
  });

  it("(x+x+)+y exceeds the budget on its own letters", () => {
    // Given: a pattern that is fast on 'a' probes but evil on 'x'
    // When / Then
    expect(exceedsBacktrackBudget("(x+x+)+y")).toBe(true);
  });

  it("(a|aa)+$ exceeds the budget at a longer probe length", () => {
    // Given: a slow-growing pattern, cheap at 24 chars but seconds at 40 (#49)
    // When / Then
    expect(exceedsBacktrackBudget("(a|aa)+$")).toBe(true);
  });

  it("github\\.com stays within the budget", () => {
    // Given: a plain domain pattern
    // When / Then
    expect(exceedsBacktrackBudget("github\\.com")).toBe(false);
  });

  it("^https://github\\.com/.* stays within the budget", () => {
    // Given: an anchored URL pattern
    // When / Then
    expect(exceedsBacktrackBudget("^https://github\\.com/.*")).toBe(false);
  });

  it("an invalid pattern is not over budget", () => {
    // Given: a pattern that does not compile (syntax is addRule's check)
    // When / Then
    expect(exceedsBacktrackBudget("(")).toBe(false);
  });
});
