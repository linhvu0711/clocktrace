import { Helper, Launchd } from "@clocktrace/collector";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { DateTime, Effect, Layer } from "effect";

import { parseArgs, usage } from "./args.js";
import { type HostName, Hosts, hostNames } from "./hosts.js";
import { permissions } from "./permissions.js";
import { Prompt } from "./prompt.js";
import { setup } from "./setup.js";
import { start } from "./start.js";
import { status } from "./status.js";
import { stop } from "./stop.js";
import { version } from "./version.js";

const layers = Layer.mergeAll(
  Helper.Default,
  Hosts.Default,
  Launchd.Default,
  Prompt.Default,
  NodeContext.layer,
  DateTime.layerCurrentZoneLocal,
);

const runCommand = <E extends { readonly message: string }>(
  effect: Effect.Effect<void, E, Layer.Layer.Success<typeof layers>>,
) =>
  NodeRuntime.runMain(
    effect.pipe(
      Effect.catchAll((e) =>
        Effect.sync(() => {
          console.error(e.message);
          process.exitCode = 1;
        }),
      ),
      Effect.provide(layers),
    ),
  );

const command = parseArgs(process.argv.slice(2));

const runSetup = (hosts?: ReadonlyArray<HostName>) => runCommand(setup(hosts));

if (command === null) {
  console.error(usage);
  process.exitCode = 1;
} else if (typeof command === "object") {
  runSetup(
    command.hosts.filter((h): h is HostName => hostNames.some((n) => n === h)),
  );
} else if (command === "help") {
  console.log(usage);
} else if (command === "version") {
  console.log(version());
} else if (command === "mcp") {
  const { serveStdio } = await import("@clocktrace/mcp");
  await serveStdio();
} else if (command === "status") {
  runCommand(status());
} else if (command === "start") {
  runCommand(start());
} else if (command === "stop") {
  runCommand(stop());
} else if (command === "permissions") {
  runCommand(permissions());
} else if (command === "setup") {
  runSetup();
} else {
  console.error(usage);
  process.exitCode = 1;
}
