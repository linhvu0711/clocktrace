import { Command } from "@effect/cli";

import { mcpCommand } from "./mcp.js";
import { permissionsCommand } from "./permissions.js";
import { setupCommand } from "./setup.js";
import { startCommand } from "./start.js";
import { statusCommand } from "./status.js";
import { stopCommand } from "./stop.js";
import { version } from "./version.js";

export const command = Command.make("clocktrace").pipe(
  Command.withSubcommands([
    setupCommand,
    startCommand,
    stopCommand,
    statusCommand,
    permissionsCommand,
    mcpCommand,
  ]),
);

export const run = Command.run(command, {
  name: "clocktrace",
  version: version(),
});
