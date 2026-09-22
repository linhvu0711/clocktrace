import { performance } from "node:perf_hooks";

export const budgetMs = 10;
export const probeLengths = [16, 24, 32, 40, 48, 56, 64] as const;

/**
 * A bound, not a proof: a probe that never matches is what triggers the
 * exponential path, so each probe ends in a tail the pattern cannot match
 * (Node.js, "Don't block the event loop"). The pattern's own letters are
 * probed because e.g. `(x+x+)+y` is fast on `a` probes. V8 runs a regex's
 * first execution in its interpreter, about five times slower than the
 * native code it tiers up to, so one warm-up run precedes the timed probes.
 *
 * Catastrophic backtracking grows super-linearly with the input, so a single
 * short probe misses a pattern that is cheap at 24 chars but stalls on a
 * longer title, e.g. `(a|aa)+$` (issue #49). Each pattern is timed at rising
 * lengths and rejected on the first that crosses the budget. The lengths
 * ascend and the scan short-circuits, so the probe stops at the first slow
 * length and never itself reaches the multi-second case.
 */
export const exceedsBacktrackBudget = (pattern: string): boolean => {
  let re: RegExp;
  try {
    re = new RegExp(pattern, "i");
  } catch {
    return false;
  }
  re.test("");
  const letters = pattern
    .toLowerCase()
    .split("")
    .filter((ch) => /[a-z0-9]/.test(ch));
  const probes = [...new Set([...letters, "a", "/", " ", "-", "1"])];
  return probes.some((ch) =>
    ["!", "\n"].some((tail) =>
      probeLengths.some((length) => {
        const start = performance.now();
        re.test(ch.repeat(length) + tail);
        return performance.now() - start > budgetMs;
      }),
    ),
  );
};
