import { checkSync } from "recheck";

// recheck's default `synckit` backend runs the analysis in a worker and
// waits on its reply with no bound (`SYNCKIT_TIMEOUT` is unset), so a
// stalled worker would hang the process — the thing this check exists to
// prevent. `pure` runs the same analysis on this thread, where `timeout`
// below is the whole wait. `??=` keeps an operator's own setting.
process.env.RECHECK_SYNC_BACKEND ??= "pure";

/**
 * Static analysis, not a timing probe: recheck reads the pattern's shape,
 * so a catastrophic branch counts even when no probe input could reach it —
 * e.g. `(?=a{64})(a+)+$`, whose blow-up is gated behind a minimum input
 * length and blocked inside `RegExp.test` forever (issue #125, follow-up to
 * #49/#123). `timeout` bounds one analysis at about half a second; a
 * typical pattern takes single-digit ms.
 *
 * Fail-closed: any verdict short of proven-safe — `vulnerable`, `unknown`
 * on a timeout, unsupported syntax, or analyzer error, and `checkSync`
 * itself throwing — reports over budget. A rejected rule fails loudly in
 * `addRule`; an accepted catastrophic pattern would hang `resolve` on a
 * later title instead.
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
  try {
    return checkSync(pattern, "i", { timeout: 500 }).status !== "safe";
  } catch {
    return true;
  }
};
