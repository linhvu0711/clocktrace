import { ConfigProvider, Effect } from "effect";
import { describe, expect, it } from "vitest";

import { configuredDbPath, helperPathFor } from "../src/config.js";
import { CollectorPaths } from "../src/paths.js";

describe("helperPathFor", () => {
  it("a workspace build finds the Helper in the helper package's release folder", () => {
    // Given
    const moduleUrl = "file:///repo/packages/collector/dist/config.js";
    // When
    const path = helperPathFor(moduleUrl);
    // Then
    expect(path).toBe("/repo/packages/helper/.build/release/clocktrace-helper");
  });

  it("an installed copy finds the Helper in helper/ at its root", () => {
    // Given
    const moduleUrl =
      "file:///opt/clocktrace/node_modules/.pnpm/@clocktrace+collector@file+packages+collector/node_modules/@clocktrace/collector/dist/config.js";
    // When
    const path = helperPathFor(moduleUrl);
    // Then
    expect(path).toBe("/opt/clocktrace/helper/clocktrace-helper");
  });
});

describe("configuredDbPath", () => {
  it("the database defaults under the home folder", () => {
    // Given: no CLOCKTRACE_DB and the home folder /Users/me
    // When
    const path = Effect.runSync(
      configuredDbPath.pipe(
        Effect.provide(CollectorPaths.Default("/Users/me")),
        Effect.withConfigProvider(ConfigProvider.fromMap(new Map())),
      ),
    );
    // Then
    expect(path).toBe(
      "/Users/me/Library/Application Support/clocktrace/clocktrace.db",
    );
  });
});
