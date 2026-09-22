import { existsSync } from "node:fs";
import {
  AppStore,
  type DatabaseNewerError,
  Store,
  type StoreError,
} from "@clocktrace/core";
import { Data, Effect, Layer } from "effect";

export class NotInstalledError extends Data.TaggedError("NotInstalledError")<{
  readonly path: string;
}> {
  override get message(): string {
    return "not set up, run clocktrace setup";
  }
}

export const InstalledStore = (
  path: string,
): Layer.Layer<
  Store | AppStore,
  NotInstalledError | StoreError | DatabaseNewerError
> =>
  Layer.unwrapEffect(
    Effect.gen(function* () {
      if (!existsSync(path)) {
        return yield* new NotInstalledError({ path });
      }
      return Layer.mergeAll(Store.Default(path), AppStore.Default);
    }),
  );
