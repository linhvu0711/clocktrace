import { version } from "./version.js";

const [arg] = process.argv.slice(2);

if (arg === "--version" || arg === "-v") {
  console.log(version());
} else {
  console.log("clocktrace: nothing here yet. Try --version.");
}
