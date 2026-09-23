import { homedir } from "node:os";

import { App, CollectorPaths, Helper, Launchd } from "@clocktrace/collector";
import * as ValidationError from "@effect/cli/ValidationError";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { DateTime, Effect, Layer } from "effect";

import { isFriendlyError, run } from "./cli.js";
import { Style } from "./format.js";
import { Hosts } from "./hosts.js";
import { ReportedError } from "./output.js";
import { Prompt, Stdin, StoppedError } from "./prompt.js";

// The macOS paths are built once, here, from the home folder.
const paths = CollectorPaths.Default(homedir());

const layers = Layer.mergeAll(
  App.Default,
  Helper.Default,
  Hosts.Default,
  Launchd.Default,
  Prompt.Default,
  Stdin.Default,
  Style.Default,
  NodeContext.layer,
  DateTime.layerCurrentZoneLocal,
).pipe(Layer.provideMerge(paths));

run(process.argv).pipe(
  Effect.catchAll((e) =>
    Effect.sync(() => {
      if (
        !ValidationError.isValidationError(e) &&
        !isFriendlyError(e) &&
        !(e instanceof ReportedError)
      ) {
        console.error((e as { message: string }).message);
      }
      process.exitCode = e instanceof StoppedError ? 130 : 1;
    }),
  ),
  Effect.provide(layers),
  NodeRuntime.runMain,
);
