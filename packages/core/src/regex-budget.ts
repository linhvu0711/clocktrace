import { checkSync } from "recheck";

/**
 * Patterns past this length are rejected without analysis: it is recheck's
 * own `maxPatternSize` bound, and a pattern over it could only come back
 * `unknown` — after seconds of parsing on this thread.
 */
export const maxPatternLength = 1500;

/**
 * Static analysis, not a timing probe: recheck reads the pattern's shape,
 * so a catastrophic branch counts even when no probe input could reach it —
 * e.g. `(?=a{64})(a+)+$`, whose blow-up is gated behind a minimum input
 * length and blocked inside `RegExp.test` forever (issue #125, follow-up to
 * #49/#123). `timeout` bounds one analysis at about half a second; a
 * typical pattern takes single-digit ms.
 *
 * Fail-closed: any verdict short of proven-safe reports over budget —
 * `vulnerable`, `unknown` on a timeout, unsupported syntax, or analyzer
 * error, a `checkSync` throw, and a pattern longer than `maxPatternLength`.
 * A rejected rule fails loudly in `addRule`; an accepted catastrophic
 * pattern would hang `resolve` on a later title instead.
 *
 * A pattern that does not compile returns `false`: syntax errors are
 * `addRule`'s own `not a valid regex` check, not a budget problem.
 */
export const exceedsBacktrackBudget = (pattern: string): boolean => {
  try {
    new RegExp(pattern, "i");
  } catch {
    return false;
  }
  if (pattern.length > maxPatternLength) {
    return true;
  }
  // The `pure` backend keeps the analysis on this thread, where `timeout`
  // is the whole wait — the default `synckit` backend would also wait on
  // its worker's reply with no bound (`SYNCKIT_TIMEOUT` unset). The pin is
  // scoped to this call and restored, so the host's env is untouched.
  const previous = process.env.RECHECK_SYNC_BACKEND;
  process.env.RECHECK_SYNC_BACKEND = "pure";
  try {
    return checkSync(pattern, "i", { timeout: 500 }).status !== "safe";
  } catch {
    return true;
  } finally {
    if (previous === undefined) {
      delete process.env.RECHECK_SYNC_BACKEND;
    } else {
      process.env.RECHECK_SYNC_BACKEND = previous;
    }
  }
};
