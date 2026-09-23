import { FileSystem } from "@effect/platform";
import { Data, Effect } from "effect";

import { Launchd } from "./launchd.js";

export class NotSetUpError extends Data.TaggedError("NotSetUpError")<{
  readonly dbPath: string;
}> {
  override get message(): string {
    return `not set up, run clocktrace setup · looked for ${this.dbPath}`;
  }
}

export const requireInstalled = (
  dbPath: string,
): Effect.Effect<void, NotSetUpError, Launchd | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const launchd = yield* Launchd;
    const fs = yield* FileSystem.FileSystem;
    const installed = yield* launchd.isInstalled();
    const hasDb = yield* fs.exists(dbPath).pipe(Effect.orDie);
    if (!installed || !hasDb) {
      return yield* new NotSetUpError({ dbPath });
    }
  });
