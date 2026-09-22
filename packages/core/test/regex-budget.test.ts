import { checkSync } from "recheck";
import { describe, expect, it, vi } from "vitest";

import { exceedsBacktrackBudget, maxPatternLength } from "../src/index.js";

vi.mock("recheck", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recheck")>();
  return { ...actual, checkSync: vi.fn(actual.checkSync) };
});

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

  it("a lookahead-gated pattern exceeds the budget within the bound", () => {
    // Given: a catastrophic branch behind a minimum-length gate (#125)
    // When
    const start = performance.now();
    const over = exceedsBacktrackBudget("(?=a{64})(a+)+$");
    const elapsed = performance.now() - start;
    // Then
    expect(over).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });

  it("(?=a{40})(a+)+$ exceeds the budget", () => {
    // Given: the same gate at a lower minimum length
    // When / Then
    expect(exceedsBacktrackBudget("(?=a{40})(a+)+$")).toBe(true);
  });

  it("a pattern the checker cannot decide is rejected (fail-closed)", () => {
    // Given: the analyzer reports unknown — a timeout, unsupported syntax,
    // or an analyzer error on a pattern that does compile
    vi.mocked(checkSync).mockReturnValueOnce({
      source: "a+",
      flags: "i",
      status: "unknown",
      error: { kind: "timeout" },
    });
    // When / Then
    expect(exceedsBacktrackBudget("a+")).toBe(true);
  });

  it("a throwing analyzer is rejected (fail-closed)", () => {
    // Given: the checker throws before producing diagnostics — a worker
    // failure or a bad RECHECK_SYNC_BACKEND
    vi.mocked(checkSync).mockImplementationOnce(() => {
      throw new Error("invalid sync backend");
    });
    // When / Then
    expect(exceedsBacktrackBudget("a+")).toBe(true);
  });

  it("a long but analyzable pattern is still checked", () => {
    // Given: a valid pattern over 1500 chars — a generated alternation of
    // bundle IDs — that the analyzer can prove safe in ms
    const alternation = Array.from(
      { length: 150 },
      (_, i) => `com\\.example\\.app${i}`,
    ).join("|");
    // When / Then
    expect(exceedsBacktrackBudget(alternation)).toBe(false);
  });

  it("a pattern past the analysis bound is rejected without analysis", () => {
    // Given: a valid pattern too long to analyze within the timeout —
    // the checker could only answer unknown, after seconds of parsing
    // When / Then
    expect(exceedsBacktrackBudget("a".repeat(maxPatternLength + 1))).toBe(true);
  });

  it("a pattern at the analysis bound is still checked", () => {
    // Given: a benign pattern exactly maxPatternLength long — mocked, so
    // the test proves it reaches the analyzer instead of racing the
    // timeout on a quarter-million-char parse
    const pattern = "a".repeat(maxPatternLength);
    vi.mocked(checkSync).mockReturnValueOnce({
      source: pattern,
      flags: "i",
      status: "safe",
      checker: "automaton",
      complexity: { type: "linear", summary: "linear", isFuzz: false },
    });
    // When / Then
    expect(exceedsBacktrackBudget(pattern)).toBe(false);
    expect(checkSync).toHaveBeenCalledWith(pattern, "i", { timeout: 500 });
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
