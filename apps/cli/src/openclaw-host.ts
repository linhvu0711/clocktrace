import { join } from "node:path";

import {
  cliHost,
  envPairs,
  jsonPrior,
  noServerNamedClocktrace,
} from "./cli-host.js";

export const openclawHost = cliHost({
  name: "openclaw",
  label: "openclaw",
  title: "OpenClaw",
  detectPath: ".openclaw",
  configFile: join(".openclaw", "openclaw.json"),
  readPrior: jsonPrior(["mcp", "servers", "clocktrace"]),
  addArgv: ({ command, args, env }, quote) => [
    "mcp",
    "add",
    "clocktrace",
    "--command",
    quote(command),
    ...envPairs(env).flatMap((p) => ["--env", quote(p)]),
    ...args.flatMap((a) => ["--arg", quote(a)]),
  ],
  removeArgv: ["mcp", "unset", "clocktrace"],
  notRegistered: noServerNamedClocktrace,
});
