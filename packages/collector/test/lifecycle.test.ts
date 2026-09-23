import { Effect, Exit, Layer, Option, Ref, Schedule, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { App, AppError } from "../src/app.js";
import {
  entryPath,
  fakeLaunchd,
  type Launchd,
  type LaunchdState,
} from "../src/launchd.js";
import { type InstallProgress, Lifecycle } from "../src/lifecycle.js";
import { CollectorPaths } from "../src/paths.js";
import {
  type CollectorPlist,
  CollectorPlistFromJson,
  collectorPlist,
} from "../src/plist.js";

// The previous agent's plist, in every case that has one.
const samplePlist: CollectorPlist = {
  app: "/Users/me/Applications/Clocktrace.app/Contents/MacOS/Clocktrace",
  node: "/usr/local/bin/node",
  entry: "/repo/main.js",
  databasePath: "/old/clocktrace.db",
  helperPath: "/old-helper",
  logPath: "/Users/me/Library/Logs/clocktrace/collector.log",
};

const fresh: LaunchdState = {
  installed: false,
  running: false,
  plist: null,
  installs: 0,
};

const settings = { databasePath: "/data/clocktrace.db", helperPath: "/stub" };

// Counts installs, commits, and rollbacks, like the real App on disk.
const fakeApp = (
  installs: Ref.Ref<number>,
  committed: Ref.Ref<number>,
  rolledBack: Ref.Ref<number>,
) =>
  Layer.succeed(
    App,
    new App({
      isInstalled: () => Effect.map(Ref.get(installs), (n) => n > 0),
      install: () =>
        Ref.update(installs, (n) => n + 1).pipe(Effect.as("written" as const)),
      commit: () => Ref.update(committed, (n) => n + 1),
      rollback: () => Ref.update(rolledBack, (n) => n + 1),
      remove: () => Ref.set(installs, 0).pipe(Effect.as("removed" as const)),
    }),
  );

const run = <A, E>(
  initial: LaunchdState,
  use: (
    lifecycle: Lifecycle,
    progress: InstallProgress<never>,
  ) => Effect.Effect<A, E>,
  opts: {
    readonly launchd?: Parameters<typeof fakeLaunchd>[1];
    readonly launchdLayer?: (
      state: Ref.Ref<LaunchdState>,
    ) => Layer.Layer<Launchd>;
    readonly app?: Layer.Layer<App>;
  } = {},
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const state = yield* Ref.make(initial);
      const installs = yield* Ref.make(0);
      const commits = yield* Ref.make(0);
      const rollbacks = yield* Ref.make(0);
      const steps = yield* Ref.make<ReadonlyArray<string>>([]);
      const progress: InstallProgress<never> = {
        done: (step) => Ref.update(steps, (s) => [...s, step]),
        starting: (wait) =>
          Ref.update(steps, (s) => [...s, "starting"]).pipe(
            Effect.andThen(wait),
          ),
      };
      const layer = Lifecycle.Default(Schedule.recurs(3)).pipe(
        Layer.provide(
          Layer.mergeAll(
            (opts.launchdLayer ?? ((s) => fakeLaunchd(s, opts.launchd)))(state),
            opts.app ?? fakeApp(installs, commits, rollbacks),
            CollectorPaths.Default("/Users/me"),
          ),
        ),
      );
      const exit = yield* Effect.exit(
        Effect.flatMap(Lifecycle, (l) => use(l, progress)).pipe(
          Effect.provide(layer),
        ),
      );
      return {
        exit,
        steps: yield* Ref.get(steps),
        state: yield* Ref.get(state),
        appInstalls: yield* Ref.get(installs),
        appCommits: yield* Ref.get(commits),
        appRollbacks: yield* Ref.get(rollbacks),
      };
    }),
  );

const install = (l: Lifecycle, p: InstallProgress<never>) =>
  l.install(settings, p);

describe("Lifecycle.install", () => {
  it("install on a fresh Mac loads the Collector", async () => {
    // Given: no agent, no App
    // When
    const { exit, steps, state, appCommits } = await run(fresh, install);
    // Then
    expect(exit).toEqual(Exit.succeed("loaded"));
    expect(steps).toEqual(["app", "agent", "starting"]);
    expect(state).toEqual({
      installed: true,
      running: true,
      installs: 1,
      plist: {
        app: "/Users/me/Applications/Clocktrace.app/Contents/MacOS/Clocktrace",
        node: process.execPath,
        entry: entryPath,
        databasePath: "/data/clocktrace.db",
        helperPath: "/stub",
        logPath: "/Users/me/Library/Logs/clocktrace/collector.log",
      },
    });
    expect(appCommits).toBe(1);
  });

  it("install again rewrites the agent and loads it", async () => {
    // Given: a running agent from an earlier install
    const { exit, state, appCommits } = await run(
      { installed: true, running: true, plist: samplePlist, installs: 1 },
      install,
    );
    // Then
    expect(exit).toEqual(Exit.succeed("loaded"));
    expect(state.installs).toBe(2);
    expect(appCommits).toBe(1);
  });

  it("install over a stopped agent loads it again", async () => {
    // Given: the plist present, the Collector not loaded
    const { exit, state } = await run(
      { installed: true, running: false, plist: samplePlist, installs: 1 },
      install,
    );
    // Then
    expect(exit).toEqual(Exit.succeed("loaded"));
    expect(state.running).toBe(true);
    expect(state.installs).toBe(2);
  });

  it("a slow start still loads", async () => {
    // Given: the Collector reaches running only after two stopped samples
    const { exit } = await run(fresh, install, {
      launchd: { stalledSamples: 2 },
    });
    // Then: the bounded wait outlasts them
    expect(exit).toEqual(Exit.succeed("loaded"));
  });

  it("a failed App install stops before the agent", async () => {
    // Given: the App install fails at codesign
    const appFails = Layer.succeed(
      App,
      new App({
        isInstalled: () => Effect.succeed(false),
        install: () =>
          Effect.fail(new AppError({ step: "codesign", detail: "exit 1" })),
        commit: () => Effect.void,
        rollback: () => Effect.void,
        remove: () => Effect.succeed("absent" as const),
      }),
    );
    // When
    const { exit, steps, state } = await run(fresh, install, {
      app: appFails,
    });
    // Then
    expect(exit).toEqual(
      Exit.fail(new AppError({ step: "codesign", detail: "exit 1" })),
    );
    expect(steps).toEqual([]);
    expect(state.installs).toBe(0);
  });
});

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
