import { Store } from "@clocktrace/core";
import { NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";

import { dbPathConfig } from "./config.js";
import { Helper } from "./helper.js";
import { MacIdentity } from "./mac-identity.js";
import { runCollector } from "./run.js";
import { version } from "./version.js";

const [arg] = process.argv.slice(2);

if (arg === "run") {
  const layers = Layer.mergeAll(
    Helper.Default,
    MacIdentity.Default,
    Layer.unwrapEffect(Effect.map(dbPathConfig, (path) => Store.Default(path))),
  );
  NodeRuntime.runMain(
    runCollector().pipe(
      Effect.catchTag("HelperNotFoundError", (e) =>
        Effect.sync(() => {
          console.error(e.message);
          process.exitCode = 1;
        }),
      ),
      Effect.provide(layers),
    ),
  );
} else if (arg === "--version" || arg === "-v") {
  console.log(version());
} else {
  console.log("clocktrace: nothing here yet. Try --version.");
}
