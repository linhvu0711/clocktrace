import { Helper, Launchd } from "@clocktrace/collector";
import * as ValidationError from "@effect/cli/ValidationError";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { DateTime, Effect, Layer } from "effect";

import { isFriendlyError, run } from "./cli.js";
import { Hosts } from "./hosts.js";
import { Prompt, StoppedError } from "./prompt.js";

const layers = Layer.mergeAll(
  Helper.Default,
  Hosts.Default,
  Launchd.Default,
  Prompt.Default,
  NodeContext.layer,
  DateTime.layerCurrentZoneLocal,
);

run(process.argv).pipe(
  Effect.catchAll((e) =>
    Effect.sync(() => {
      if (!ValidationError.isValidationError(e) && !isFriendlyError(e)) {
        console.error((e as { message: string }).message);
      }
      process.exitCode = e instanceof StoppedError ? 130 : 1;
    }),
  ),
  Effect.provide(layers),
  NodeRuntime.runMain,
);
