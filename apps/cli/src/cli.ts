import { Command } from "@effect/cli";

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
import { version } from "./version.js";

export const command = Command.make("clocktrace").pipe(
  Command.withSubcommands([
    setupCommand,
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
  ]),
);

const cliRun = Command.run(command, {
  name: "clocktrace",
  version: version(),
});

// The library's built-in version option has no short alias; keep the old
// parser's lone `-v`.
export const run: typeof cliRun = (args) =>
  cliRun(
    args.length === 3 && args[2] === "-v"
      ? [...args.slice(0, 2), "--version"]
      : args,
  );
