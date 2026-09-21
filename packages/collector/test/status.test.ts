import { Store } from "@clocktrace/core";
import { NodeContext } from "@effect/platform-node";
import {
  ConfigProvider,
  DateTime,
  Effect,
  Exit,
  Layer,
  Ref,
  Stream,
} from "effect";
import { describe, expect, it } from "vitest";

import { Helper, HelperNotFoundError } from "../src/helper.js";
import { fakeLaunchd, Launchd, type LaunchdState } from "../src/launchd.js";
import type { Permissions } from "../src/permissions.js";
import { readStatus, statusLines } from "../src/status.js";

const dbPath = "/Users/me/Library/Application Support/clocktrace/clocktrace.db";

const stubHelper = (p: Permissions) =>
  Layer.succeed(
    Helper,
    new Helper({
      check: () => Effect.void,
      lines: () => Stream.empty,
      permissions: () => Effect.succeed(p),
      request: () => Effect.succeed("asked"),
    }),
  );

const config = ConfigProvider.fromMap(
  new Map([
    ["CLOCKTRACE_HELPER", "/stub"],
    ["CLOCKTRACE_DB", dbPath],
  ]),
);

const runWith = (
  p: Permissions,
  launchdState: LaunchdState,
  inside: Effect.Effect<
    ReadonlyArray<string>,
    unknown,
    Store | Helper | Launchd | DateTime.CurrentTimeZone
  >,
) =>
  Effect.runPromise(
    Effect.flatMap(Ref.make(launchdState), (state) =>
      inside.pipe(
        Effect.provide(
          Layer.mergeAll(stubHelper(p), fakeLaunchd(state), Store.Test),
        ),
        Effect.withConfigProvider(config),
        DateTime.withCurrentZoneNamed("America/Los_Angeles"),
      ),
    ),
  );

describe("status", () => {
  it("a stopped Collector with denied grants and no Activities", async () => {
    // Given: a stopped agent, denied grants, an empty store
    // When
    const lines = await runWith(
      {
        accessibility: "denied",
        automation: {
          "com.apple.Safari": "notRunning",
          "com.google.Chrome": "notAsked",
          "com.brave.Browser": "notInstalled",
        },
        fullDiskAccess: "denied",
      },
      { installed: true, running: false, plist: null, installs: 0 },
      Effect.flatMap(readStatus(), statusLines),
    );
    // Then
    expect(lines).toEqual([
      "collector: stopped, run clocktrace start",
      "accessibility: denied, window titles are not tracked",
      "automation Safari: not checked, Safari is not running",
      "automation Chrome: denied, URLs in Chrome are not tracked",
      "full disk access: denied, iPhone and iPad time is not imported",
      "last activity: none yet",
      `database: ${dbPath}`,
    ]);
  });

  it("a running Collector with every grant and one Activity", async () => {
    // Given: a running agent, every grant, one Activity on one device
    // When
    const lines = await runWith(
      {
        accessibility: "granted",
        automation: { "com.apple.Safari": "granted" },
        fullDiskAccess: "granted",
      },
      { installed: true, running: true, plist: null, installs: 0 },
      Effect.gen(function* () {
        const store = yield* Store;
        const device = yield* store.getOrInsertDevice({
          kind: "mac",
          name: "Studio",
          externalId: "mac-1",
        });
        yield* store.insertActivity({
          deviceId: device.id,
          bundleId: "com.apple.finder",
          appName: "Finder",
          title: null,
          url: null,
          startedAt: DateTime.unsafeMake("2026-09-18T17:00:00Z"),
          endedAt: DateTime.unsafeMake("2026-09-18T17:05:00Z"),
        });
        const status = yield* readStatus();
        return yield* statusLines(status);
      }),
    );
    // Then
    expect(lines).toEqual([
      "collector: running",
      "accessibility: granted",
      "automation Safari: granted",
      "full disk access: granted",
      "last activity: 2026-09-18 10:05",
      `database: ${dbPath}`,
    ]);
  });

  it("readStatus fails with HelperNotFoundError when the binary is missing", async () => {
    // Given: CLOCKTRACE_HELPER points at a path that does not exist
    const layers = Layer.mergeAll(
      Helper.Default,
      Launchd.Test,
      Store.Test,
      NodeContext.layer,
    );
    // When
    const exit = await Effect.runPromise(
      Effect.exit(readStatus()).pipe(
        Effect.provide(layers),
        Effect.withConfigProvider(
          ConfigProvider.fromMap(
            new Map([
              ["CLOCKTRACE_HELPER", "/nope/clocktrace-helper"],
              ["CLOCKTRACE_DB", dbPath],
            ]),
          ),
        ),
      ),
    );
    // Then
    expect(exit).toEqual(
      Exit.fail(new HelperNotFoundError({ path: "/nope/clocktrace-helper" })),
    );
  });
});
