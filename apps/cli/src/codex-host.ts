import { join } from "node:path";

import { parse } from "smol-toml";

import {
  cliHost,
  dig,
  envPairs,
  noServerNamedClocktrace,
  stdioPrior,
} from "./cli-host.js";
import type { Registration } from "./host.js";

// Codex keeps the env as an [mcp_servers.clocktrace.env] sub-table or an
// inline `env = { … }` table; a parser reads both the same way.
const tomlPrior = (text: string): Registration | null => {
  try {
    return stdioPrior(dig(parse(text), ["mcp_servers", "clocktrace"]));
  } catch {
    return null;
  }
};

export const codexHost = cliHost({
  name: "codex",
  label: "codex",
  title: "Codex",
  detectPath: ".codex",
  configFile: join(".codex", "config.toml"),
  readPrior: tomlPrior,
  addArgv: ({ command, args, env }, quote) => [
    "mcp",
    "add",
    "clocktrace",
    ...envPairs(env).flatMap((p) => ["--env", quote(p)]),
    "--",
    quote(command),
    ...args.map(quote),
  ],
  removeArgv: ["mcp", "remove", "clocktrace"],
  notRegistered: noServerNamedClocktrace,
});
