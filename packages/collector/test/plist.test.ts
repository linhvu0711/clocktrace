import { describe, expect, it } from "vitest";

import { collectorPlist } from "../src/plist.js";

const input = {
  node: "/usr/local/bin/node",
  entry: "/repo/packages/collector/dist/main.js",
  databasePath:
    "/Users/me/Library/Application Support/clocktrace/clocktrace.db",
  helperPath: "/repo/packages/helper/.build/release/clocktrace-helper",
  logPath: "/Users/me/Library/Logs/clocktrace/collector.log",
};

describe("collectorPlist", () => {
  it("runs node on the entry file with RunAtLoad and KeepAlive", () => {
    // Given: input
    // When
    const plist = collectorPlist(input);
    // Then
    expect(plist).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.clocktrace.collector</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/repo/packages/collector/dist/main.js</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CLOCKTRACE_DB</key>
    <string>/Users/me/Library/Application Support/clocktrace/clocktrace.db</string>
    <key>CLOCKTRACE_HELPER</key>
    <string>/repo/packages/helper/.build/release/clocktrace-helper</string>
  </dict>
  <key>StandardOutPath</key>
  <string>/Users/me/Library/Logs/clocktrace/collector.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/me/Library/Logs/clocktrace/collector.log</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`);
  });

  it("a value with & is escaped", () => {
    // Given: the same input with an & in the entry path
    // When
    const plist = collectorPlist({ ...input, entry: "/Users/a&b/main.js" });
    // Then
    expect(plist).toContain("<string>/Users/a&amp;b/main.js</string>");
    expect(plist).not.toContain("a&b/");
  });

  it("no CLI word is in the plist", () => {
    // Given: the first test's input
    // When
    const has = /clocktrace (run|setup|start|stop|status|permissions|mcp)/.test(
      collectorPlist(input),
    );
    // Then
    expect(has).toBe(false);
  });
});
