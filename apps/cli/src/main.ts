import { version } from "./version.js";

const [arg] = process.argv.slice(2);

if (arg === "--version" || arg === "-v") {
  console.log(version());
} else if (arg === "mcp") {
  const { serveStdio } = await import("@clocktrace/mcp");
  await serveStdio();
} else {
  console.log("clocktrace: nothing here yet. Try --version.");
}
