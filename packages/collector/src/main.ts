// Private entry for the launchd agent. Not a command: only the plist starts it.
import { homedir } from "node:os";

import { Store } from "@clocktrace/core";
import { NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";

import { configuredDbPath } from "./config.js";
import { Helper } from "./helper.js";
import { MacIdentity } from "./mac-identity.js";
import { CollectorPaths } from "./paths.js";
import { runCollector } from "./run.js";

const layers = Layer.mergeAll(
  Helper.Default,
  MacIdentity.Default,
  Layer.unwrapEffect(
    Effect.map(configuredDbPath, (path) => Store.Default(path)),
  ).pipe(Layer.provide(CollectorPaths.Default(homedir()))),
);

NodeRuntime.runMain(runCollector().pipe(Effect.provide(layers)));
