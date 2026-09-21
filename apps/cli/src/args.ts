export const commands = [
  "setup",
  "start",
  "stop",
  "status",
  "permissions",
  "mcp",
] as const;

export type CommandName = (typeof commands)[number];

export const usage =
  "usage: clocktrace (setup | start | stop | status | permissions | mcp | --version)";

export const parseArgs = (
  argv: ReadonlyArray<string>,
): CommandName | "version" | "help" | null => {
  if (argv.length !== 1) {
    return null;
  }
  const [arg] = argv;
  if (arg === "--version" || arg === "-v") {
    return "version";
  }
  if (arg === "--help" || arg === "-h") {
    return "help";
  }
  if (commands.includes(arg as CommandName)) {
    return arg as CommandName;
  }
  return null;
};
