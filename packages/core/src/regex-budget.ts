import { performance } from "node:perf_hooks";

export const probeLength = 24;
export const budgetMs = 10;

/**
 * A bound, not a proof: a probe that never matches is what triggers the
 * exponential path, so each probe ends in a tail the pattern cannot match
 * (Node.js, "Don't block the event loop"). The pattern's own letters are
 * probed because e.g. `(x+x+)+y` is fast on `a` probes. V8 runs a regex's
 * first execution in its interpreter, about five times slower than the
 * native code it tiers up to, so one warm-up run precedes the timed probes.
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
    ["!", "\n"].some((tail) => {
      const start = performance.now();
      re.test(ch.repeat(probeLength) + tail);
      return performance.now() - start > budgetMs;
    }),
  );
};
