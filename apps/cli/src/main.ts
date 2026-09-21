import { parseArgs, usage } from "./args.js";
import { version } from "./version.js";

const command = parseArgs(process.argv.slice(2));

if (command === null) {
  console.error(usage);
  process.exitCode = 1;
} else if (command === "help") {
  console.log(usage);
} else if (command === "version") {
  console.log(version());
} else if (command === "mcp") {
  const { serveStdio } = await import("@clocktrace/mcp");
  await serveStdio();
} else {
  console.error(usage);
  process.exitCode = 1;
}
