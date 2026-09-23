import { Config, Data, Effect, Layer, Option, Schedule } from "effect";

import { App } from "./app.js";
import { entryPath, Launchd, LaunchdError } from "./launchd.js";
import { CollectorPaths } from "./paths.js";
import type { CollectorSettings } from "./plist.js";

// launchctl bootstrap returns before a RunAtLoad agent has reached running,
// so poll the state for a bounded window instead of trusting one sample.
// A re-run boots the agent out first, and relaunching a KeepAlive job after
// bootout takes much longer than the fresh-install path, so the window is
// wall-clock bounded: a slow `launchctl print` must not eat the budget.
export const loadRetry = Schedule.spaced("100 millis").pipe(
  Schedule.upTo("45 seconds"),
);

// The Collector did not reach Loaded. The old App and plist were put back
// first; `appRestored` is false when the App could not be, and
// `agentRestored` when the old plist could not be.
export class CollectorNotLoadedError extends Data.TaggedError(
  "CollectorNotLoadedError",
)<{
  readonly cause: LaunchdError;
  readonly appRestored: boolean;
  readonly agentRestored: boolean;
}> {
  override get message(): string {
    return this.cause.message;
  }
}

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
      const { appMainPath, logPath, defaultDbPath } = yield* CollectorPaths;
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
      // The settings the installed plist holds, or null with no plist.
      const settings = (): Effect.Effect<
        CollectorSettings | null,
        LaunchdError
      > =>
        launchd
          .readPlist()
          .pipe(Effect.map((plist) => plist?.settings ?? null));
      return {
        // Swaps in the App, replaces the agent, and waits until the
        // Collector is Loaded. On a failure it puts the old App and plist
        // back.
        install: <R>(
          settings: CollectorSettings,
          progress: InstallProgress<R>,
        ) =>
          Effect.gen(function* () {
            yield* app.install(settings.helperPath);
            yield* progress.done("app");
            const installed = yield* launchd.isInstalled();
            const previous = installed ? yield* launchd.readPlist() : null;
            if (installed) {
              yield* launchd.bootout();
            }
            // A fresh install that fails is removed; a rewrite that fails
            // puts the previous app and agent back, unloading the new one
            // first so the old plist is the one launchd runs. An unload
            // that fails stops the restore there, before the App rollback,
            // so the App counts as not put back.
            const restore = Effect.gen(function* () {
              yield* launchd.uninstall();
              const appRestored = yield* app.rollback().pipe(
                Effect.as(true),
                Effect.catchAll(() => Effect.succeed(false)),
              );
              const agentRestored =
                previous === null
                  ? true
                  : yield* launchd.restore(previous).pipe(
                      Effect.as(true),
                      Effect.catchAll(() => Effect.succeed(false)),
                    );
              return { appRestored, agentRestored };
            }).pipe(
              Effect.catchAll(() =>
                Effect.succeed({ appRestored: false, agentRestored: false }),
              ),
            );
            yield* Effect.gen(function* () {
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
            }).pipe(
              Effect.catchTag("LaunchdError", (cause) =>
                Effect.flatMap(
                  restore,
                  (restored) =>
                    new CollectorNotLoadedError({ cause, ...restored }),
                ),
              ),
            );
            // A failed .old delete must not undo a Collector that is
            // already running.
            yield* Effect.ignore(app.commit());
            return "loaded" as const;
          }),
        settings,
        // The database the installed Collector writes: CLOCKTRACE_DB set
        // for this run wins, then the plist, then the default.
        databasePath: () =>
          Effect.gen(function* () {
            const env = yield* Effect.orDie(
              Config.option(Config.string("CLOCKTRACE_DB")),
            );
            if (Option.isSome(env)) {
              return env.value;
            }
            const installed = yield* settings();
            return installed?.databasePath ?? defaultDbPath;
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
      settings: () => Effect.succeed(null),
      databasePath: () =>
        Effect.succeed(
          "/Users/me/Library/Application Support/clocktrace/clocktrace.db",
        ),
    }),
  );
}
