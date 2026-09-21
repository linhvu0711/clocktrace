import { dbPathConfig, Launchd } from "@clocktrace/collector";
import {
  type DatabaseNewerError,
  Store,
  type StoreError,
} from "@clocktrace/core";
import { FileSystem } from "@effect/platform";
import { Data, Effect } from "effect";

// biome-ignore lint/complexity/noBannedTypes: the error has no fields
export class NotSetUpError extends Data.TaggedError("NotSetUpError")<{}> {
  override get message(): string {
    return "not set up, run clocktrace setup";
  }
}

export const requireSetUp: Effect.Effect<
  void,
  NotSetUpError,
  Launchd | FileSystem.FileSystem
> = Effect.gen(function* () {
  const launchd = yield* Launchd;
  const fs = yield* FileSystem.FileSystem;
  const dbPath = yield* Effect.orDie(dbPathConfig);
  const installed = yield* launchd.isInstalled();
  const hasDb = yield* fs.exists(dbPath).pipe(Effect.orDie);
  if (!installed || !hasDb) {
    return yield* new NotSetUpError();
  }
});

export const withStore = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | StoreError | DatabaseNewerError, Exclude<R, Store>> =>
  Effect.flatMap(Effect.orDie(dbPathConfig), (path) =>
    Effect.provide(effect, Store.Default(path)),
  );
