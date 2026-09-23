import { Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { CollectorPlistFromJson, collectorPlist } from "../src/plist.js";

const input = {
  app: "/Users/me/Applications/Clocktrace.app/Contents/MacOS/Clocktrace",
  node: "/usr/local/bin/node",
  entry: "/repo/packages/collector/dist/main.js",
  databasePath:
    "/Users/me/Library/Application Support/clocktrace/clocktrace.db",
  helperPath: "/repo/packages/helper/.build/release/clocktrace-helper",
  logPath: "/Users/me/Library/Logs/clocktrace/collector.log",
};

describe("the Collector plist", () => {
  it("runs the Collector through the app's spawn verb with RunAtLoad and KeepAlive", () => {
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
    <string>/Users/me/Applications/Clocktrace.app/Contents/MacOS/Clocktrace</string>
    <string>spawn</string>
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

  // What `plutil -convert json` printed on a Mac for a plist collectorPlist
  // wrote, slashes escaped as plutil escapes them.
  const plutilJson = String.raw`{"Label":"com.clocktrace.collector","ProgramArguments":["\/Users\/me\/Applications\/Clocktrace.app\/Contents\/MacOS\/Clocktrace","spawn","\/usr\/local\/bin\/node","\/repo\/packages\/collector\/dist\/main.js"],"RunAtLoad":true,"KeepAlive":true,"EnvironmentVariables":{"CLOCKTRACE_DB":"\/Users\/me\/Work & <Play>\/clocktrace.db","CLOCKTRACE_HELPER":"\/repo\/packages\/helper\/.build\/release\/clocktrace-helper"},"StandardOutPath":"\/Users\/me\/Library\/Logs\/clocktrace\/collector.log","StandardErrorPath":"\/Users\/me\/Library\/Logs\/clocktrace\/collector.log","ProcessType":"Background"}`;

  it("the plist reads back from plutil's JSON", () => {
    // Given: plutil's JSON for a plist with a database path holding & and <
    const text = plutilJson;
    // When
    const plist = Schema.decodeUnknownSync(CollectorPlistFromJson)(text);
    // Then
    expect(plist).toEqual({
      app: "/Users/me/Applications/Clocktrace.app/Contents/MacOS/Clocktrace",
      node: "/usr/local/bin/node",
      entry: "/repo/packages/collector/dist/main.js",
      databasePath: "/Users/me/Work & <Play>/clocktrace.db",
      helperPath: "/repo/packages/helper/.build/release/clocktrace-helper",
      logPath: "/Users/me/Library/Logs/clocktrace/collector.log",
    });
  });

  it("a plist without the spawn verb reads as none", () => {
    // Given: the layout before the App owned the grants (ADR 0007)
    const text = plutilJson.replace('"spawn",', "");
    // When
    const plist = Schema.decodeUnknownOption(CollectorPlistFromJson)(text);
    // Then
    expect(plist).toEqual(Option.none());
  });
});
