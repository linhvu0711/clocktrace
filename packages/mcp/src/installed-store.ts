import {
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

export const InstalledStore = (
  path: string,
): Layer.Layer<
  Store | AppStore,
  NotSetUpError | StoreError | DatabaseNewerError,
  Launchd | FileSystem.FileSystem
> =>
  Layer.unwrapEffect(
    requireInstalled(path).pipe(
      Effect.as(Layer.mergeAll(Store.Default(path), AppStore.Default)),
    ),
  );
