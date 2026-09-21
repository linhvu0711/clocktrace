// Private entry for the launchd agent. Not a command: only the plist starts it.
import { Store } from "@clocktrace/core";
import { NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";

import { dbPathConfig } from "./config.js";
import { Helper } from "./helper.js";
import { MacIdentity } from "./mac-identity.js";
import { runCollector } from "./run.js";

const layers = Layer.mergeAll(
  Helper.Default,
  MacIdentity.Default,
  Layer.unwrapEffect(Effect.map(dbPathConfig, (path) => Store.Default(path))),
);

NodeRuntime.runMain(runCollector().pipe(Effect.provide(layers)));
