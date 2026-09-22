import { Command } from "@effect/cli";
import { Console, Effect } from "effect";

import { activitiesCommand, BadLimitError } from "./activities.js";
import { categoriesCommand } from "./categories.js";
import { mcpCommand } from "./mcp.js";
import { permissionsCommand } from "./permissions.js";
import { projectsCommand } from "./projects.js";
import { rulesCommand } from "./rules.js";
import { setupCommand } from "./setup.js";
import { startCommand } from "./start.js";
import { statusCommand } from "./status.js";
import { stopCommand } from "./stop.js";
import { summaryCommand } from "./summary.js";
import { timelineCommand } from "./timeline.js";
import { uninstallCommand } from "./uninstall.js";
import { version } from "./version.js";
import { MissingWindowError } from "./window.js";

export const command = Command.make("clocktrace").pipe(
  Command.withDescription("track where your time goes"),
  Command.withSubcommands([
    setupCommand,
    uninstallCommand,
    startCommand,
    stopCommand,
    statusCommand,
    permissionsCommand,
    mcpCommand,
    rulesCommand,
    categoriesCommand,
    projectsCommand,
    summaryCommand,
    timelineCommand,
    activitiesCommand,
  ]),
);

const cliRun = Command.run(command, {
  name: "clocktrace",
  version: version(),
});

export const isFriendlyError = (
  e: unknown,
): e is MissingWindowError | BadLimitError =>
  e instanceof MissingWindowError || e instanceof BadLimitError;

// A friendly error is one the command raised in place of a library validation
// error, so we render the whole message ourselves: one line plus an example.
export const renderFriendly = (
  e: MissingWindowError | BadLimitError,
): ReadonlyArray<string> =>
  e._tag === "MissingWindowError"
    ? [
        `${e.command} needs --from and --to.`,
        `example:  clocktrace ${e.command} --from YYYY-MM-DD --to YYYY-MM-DD`,
      ]
    : ["--limit needs a whole number."];

// The library's built-in version option has no short alias; keep the old
// parser's lone `-v`. On a friendly error, print the message here so the run
// path (which the tests exercise) owns it; main.ts skips reprinting it. Errors
// go to stderr, like the library's own validation output, so stdout stays a
// clean data channel for --json redirects.
export const run: typeof cliRun = (args) =>
  cliRun(
    args.length === 3 && args[2] === "-v"
      ? [...args.slice(0, 2), "--version"]
      : args,
  ).pipe(
    Effect.tapError((e) =>
      isFriendlyError(e)
        ? Console.error(renderFriendly(e).join("\n"))
        : Effect.void,
    ),
  );
