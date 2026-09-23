import { Effect, Layer, Schedule, Schema } from "effect";

import { App } from "./app.js";
import { entryPath, Launchd, LaunchdError } from "./launchd.js";
import { CollectorPaths } from "./paths.js";

// The settings the Collector runs with, written into its plist.
export const CollectorSettings = Schema.Struct({
  databasePath: Schema.String,
  helperPath: Schema.String,
});

export type CollectorSettings = Schema.Schema.Type<typeof CollectorSettings>;

// launchctl bootstrap returns before a RunAtLoad agent has reached running,
// so poll the state for a bounded window instead of trusting one sample.
// A re-run boots the agent out first, and relaunching a KeepAlive job after
// bootout takes much longer than the fresh-install path, so the window is
// wall-clock bounded: a slow `launchctl print` must not eat the budget.
export const loadRetry = Schedule.spaced("100 millis").pipe(
  Schedule.upTo("45 seconds"),
);

export type InstallStep = "app" | "agent";

// How install reports while it works: `done` after each step lands, and
// `starting` wraps the wait for Loaded, so a caller can show a spinner.
export type InstallProgress<R> = {
  readonly done: (step: InstallStep) => Effect.Effect<void, never, R>;
  readonly starting: <A, E>(
    wait: Effect.Effect<A, E>,
  ) => Effect.Effect<A, E, R>;
};

export class Lifecycle extends Effect.Service<Lifecycle>()("Lifecycle", {
  effect: (retry: Schedule.Schedule<unknown, unknown>) =>
    Effect.gen(function* () {
      const app = yield* App;
      const launchd = yield* Launchd;
      const { appMainPath, logPath } = yield* CollectorPaths;
      const loaded = launchd.state().pipe(
        Effect.flatMap((collector) =>
          collector === "running"
            ? Effect.void
            : new LaunchdError({
                step: "launchctl bootstrap",
                detail: "collector did not start",
                log: logPath,
              }),
        ),
        Effect.retry({ schedule: retry }),
      );
      return {
        // Swaps in the App, replaces the agent, and waits until the
        // Collector is Loaded.
        install: <R>(
          settings: CollectorSettings,
          progress: InstallProgress<R>,
        ) =>
          Effect.gen(function* () {
            yield* app.install(settings.helperPath);
            yield* progress.done("app");
            if (yield* launchd.isInstalled()) {
              yield* launchd.bootout();
            }
            yield* launchd.install({
              app: appMainPath,
              node: process.execPath,
              entry: entryPath,
              databasePath: settings.databasePath,
              helperPath: settings.helperPath,
              logPath,
            });
            yield* progress.done("agent");
            yield* progress.starting(loaded);
            // A failed .old delete must not undo a Collector that is
            // already running.
            yield* Effect.ignore(app.commit());
            return "loaded" as const;
          }),
      };
    }),
}) {
  // biome-ignore lint/style/useNamingConvention: layers are PascalCase
  static Test = Layer.succeed(
    this,
    new Lifecycle({
      install: <R>(
        _settings: CollectorSettings,
        progress: InstallProgress<R>,
      ) =>
        progress
          .done("app")
          .pipe(
            Effect.andThen(progress.done("agent")),
            Effect.andThen(progress.starting(Effect.void)),
            Effect.as("loaded" as const),
          ),
    }),
  );
}
