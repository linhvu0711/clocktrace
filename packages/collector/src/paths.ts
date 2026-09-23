import { join } from "node:path";

import { Effect } from "effect";

import { collectorLabel } from "./plist.js";

// Every macOS path the install touches, built from one home folder. The
// entry points build it once at start, so a test gives a temp home instead
// of redirecting HOME before an import.
export const collectorPaths = (home: string) => {
  const appPath = join(home, "Applications", "Clocktrace.app");
  const logDir = join(home, "Library", "Logs", "clocktrace");
  return {
    appPath,
    appMainPath: join(appPath, "Contents", "MacOS", "Clocktrace"),
    plistPath: join(home, "Library", "LaunchAgents", `${collectorLabel}.plist`),
    logDir,
    logPath: join(logDir, "collector.log"),
    defaultDbPath: join(
      home,
      "Library",
      "Application Support",
      "clocktrace",
      "clocktrace.db",
    ),
  };
};

export class CollectorPaths extends Effect.Service<CollectorPaths>()(
  "CollectorPaths",
  {
    effect: (home: string) => Effect.succeed(collectorPaths(home)),
  },
) {
  // biome-ignore lint/style/useNamingConvention: layers are PascalCase
  static Test = this.Default("/Users/me");
}
