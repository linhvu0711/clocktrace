import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The version from this package's package.json. */
export const version = (): string => {
  const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  return pkg.version;
};
