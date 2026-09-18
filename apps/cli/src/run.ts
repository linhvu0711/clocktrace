import type { Store, StoreError } from "@clocktrace/core";
import { Effect, Schedule } from "effect";
import type { ConfigError } from "effect/ConfigError";
import type { ParseError } from "effect/ParseResult";

import { collect } from "./collector.js";
import { helperPathConfig } from "./config.js";
import { Helper, type HelperNotFoundError } from "./helper.js";
import type { MacIdentity, MacIdentityError } from "./mac-identity.js";
import { registerDevice } from "./register-device.js";

export const restartSchedule = Schedule.exponential("1 second").pipe(
  Schedule.union(Schedule.spaced("30 seconds")),
);

export const runCollector = (): Effect.Effect<
  void,
  | HelperNotFoundError
  | MacIdentityError
  | ParseError
  | StoreError
  | ConfigError,
  Helper | MacIdentity | Store
> =>
  Effect.gen(function* () {
    const helperPath = yield* helperPathConfig;
    const helper = yield* Helper;
    yield* helper.check(helperPath);
    const device = yield* registerDevice();
    yield* Effect.logInfo("collector started").pipe(
      Effect.annotateLogs("deviceId", device.id),
    );
    yield* collect(helper.lines(helperPath), device.id).pipe(
      Effect.tapError(() => Effect.logWarning("helper exited, restarting")),
      Effect.retry({
        schedule: restartSchedule,
        while: (e) => e._tag === "HelperExitedError",
      }),
      // the retry never releases HelperExitedError, so it cannot reach here
      Effect.catchTag("HelperExitedError", Effect.die),
    );
  });
