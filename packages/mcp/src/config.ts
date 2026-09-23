import { homedir } from "node:os";
import { join } from "node:path";
import { Config } from "effect";

export const DbPath = Config.string("CLOCKTRACE_DB").pipe(
  Config.withDefault(
    join(
      homedir(),
      "Library",
      "Application Support",
      "clocktrace",
      "clocktrace.db",
    ),
  ),
);
