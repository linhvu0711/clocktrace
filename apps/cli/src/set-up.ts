import {
  dbPathConfig,
  type Launchd,
  type NotSetUpError,
  requireInstalled,
} from "@clocktrace/collector";
import {
  AppStore,
  type DatabaseNewerError,
  Store,
  type StoreError,
} from "@clocktrace/core";
import type { FileSystem } from "@effect/platform";
import { Effect, Layer } from "effect";

export { NotSetUpError } from "@clocktrace/collector";

export const requireSetUp: Effect.Effect<
  void,
  NotSetUpError,
  Launchd | FileSystem.FileSystem
> = Effect.flatMap(Effect.orDie(dbPathConfig), requireInstalled);

export const withStore = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<
  A,
  E | StoreError | DatabaseNewerError,
  Exclude<R, Store | AppStore>
> =>
  Effect.flatMap(Effect.orDie(dbPathConfig), (path) =>
    Effect.provide(
      effect,
      Layer.mergeAll(Store.Default(path), AppStore.Default),
    ),
  );

export const whenSetUp = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  requireSetUp.pipe(Effect.andThen(withStore(effect)));
