import { checkSync } from "recheck";

/**
 * Static analysis, not a timing probe: recheck reads the pattern's shape,
 * so a catastrophic branch counts even when no probe input could reach it —
 * e.g. `(?=a{64})(a+)+$`, whose blow-up is gated behind a minimum input
 * length and blocked inside `RegExp.test` forever (issue #125, follow-up to
 * #49/#123). On Node, `checkSync` runs through a `synckit` worker, so the
 * analysis itself cannot block this process past its bound.
 *
 * Fail-closed: any verdict short of proven-safe — `vulnerable`, or
 * `unknown` on a timeout, unsupported syntax, or analyzer error — reports
 * over budget. A rejected rule fails loudly in `addRule`; an accepted
 * catastrophic pattern would hang `resolve` on a later title instead.
 * `timeout` bounds one check at about half a second; a typical pattern
 * takes single-digit ms.
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
  return checkSync(pattern, "i", { timeout: 500 }).status !== "safe";
};
