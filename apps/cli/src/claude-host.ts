import {
  cliHost,
  envPairs,
  jsonPrior,
  noServerNamedClocktrace,
} from "./cli-host.js";

export const claudeHost = cliHost({
  name: "claude",
  label: "claude code",
  title: "Claude Code",
  detectPath: ".claude.json",
  configFile: ".claude.json",
  readPrior: jsonPrior(["mcpServers", "clocktrace"]),
  addArgv: ({ command, args, env }, quote) => [
    "mcp",
    "add",
    "--scope",
    "user",
    "clocktrace",
    ...envPairs(env).flatMap((p) => ["-e", quote(p)]),
    "--",
    quote(command),
    ...args.map(quote),
  ],
  removeArgv: ["mcp", "remove", "clocktrace", "--scope", "user"],
  notRegistered: noServerNamedClocktrace,
});
