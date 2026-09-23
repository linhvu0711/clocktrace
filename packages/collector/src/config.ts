import { homedir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { Config } from "effect";

// An installed copy (the release tarball, Homebrew's libexec) keeps the Helper
// in helper/ next to its top node_modules; a workspace build uses SwiftPM's.
export const helperPathFor = (moduleUrl: string): string => {
  const path = fileURLToPath(moduleUrl);
  const at = path.indexOf(`${sep}node_modules${sep}`);
  return at === -1
    ? fileURLToPath(
        new URL("../../helper/.build/release/clocktrace-helper", moduleUrl),
      )
    : join(path.slice(0, at), "helper", "clocktrace-helper");
};

const defaultHelperPath = helperPathFor(import.meta.url);

export const helperPathConfig = Config.string("CLOCKTRACE_HELPER").pipe(
  Config.withDefault(defaultHelperPath),
);

export const defaultDbPath = join(
  homedir(),
  "Library",
  "Application Support",
  "clocktrace",
  "clocktrace.db",
);

export const dbPathConfig = Config.string("CLOCKTRACE_DB").pipe(
  Config.withDefault(defaultDbPath),
);
