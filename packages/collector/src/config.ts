import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Config } from "effect";

const defaultHelperPath = fileURLToPath(
  new URL("../../helper/.build/release/clocktrace-helper", import.meta.url),
);

export const helperPathConfig = Config.string("CLOCKTRACE_HELPER").pipe(
  Config.withDefault(defaultHelperPath),
);

export const dbPathConfig = Config.string("CLOCKTRACE_DB").pipe(
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
