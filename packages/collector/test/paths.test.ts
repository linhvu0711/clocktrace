import { describe, expect, it } from "vitest";

import { collectorPaths } from "../src/paths.js";

describe("collectorPaths", () => {
  it("builds every path from the home folder", () => {
    // Given: the home folder /Users/me
    // When
    const paths = collectorPaths("/Users/me");
    // Then
    expect(paths).toEqual({
      appPath: "/Users/me/Applications/Clocktrace.app",
      appMainPath:
        "/Users/me/Applications/Clocktrace.app/Contents/MacOS/Clocktrace",
      plistPath:
        "/Users/me/Library/LaunchAgents/com.clocktrace.collector.plist",
      logDir: "/Users/me/Library/Logs/clocktrace",
      logPath: "/Users/me/Library/Logs/clocktrace/collector.log",
      defaultDbPath:
        "/Users/me/Library/Application Support/clocktrace/clocktrace.db",
    });
  });
});
