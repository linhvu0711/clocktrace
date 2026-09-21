import { existsSync } from "node:fs";
import {
  type DatabaseNewerError,
  Store,
  type StoreError,
} from "@clocktrace/core";
import { Data, Effect, Layer } from "effect";

export class NotInstalledError extends Data.TaggedError("NotInstalledError")<{
  readonly path: string;
}> {
  override get message(): string {
    return "clocktrace is not installed, run clocktrace install";
  }
}

export const InstalledStore = (
  path: string,
): Layer.Layer<Store, NotInstalledError | StoreError | DatabaseNewerError> =>
  Layer.unwrapEffect(
    Effect.gen(function* () {
      if (!existsSync(path)) {
        return yield* new NotInstalledError({ path });
      }
      return Store.Default(path);
    }),
  );
