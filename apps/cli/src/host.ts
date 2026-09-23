import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { type CommandExecutor, FileSystem } from "@effect/platform";
import { Effect } from "effect";

// A Host started from the Dock sees only the system PATH, so every
// Registration names the running node and the bin by absolute path —
// the same shape the launchd plist uses (ADR 0008).
export const serverNode = process.execPath;

export const serverEntry = fileURLToPath(
  new URL("../bin/clocktrace.js", import.meta.url),
);

// The shape a host add command can express; a registration carrying any
// other field cannot be restored through it.
export type Registration = {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string>>;
};

export const serverRegistration: Registration = {
  command: serverNode,
  args: [serverEntry, "mcp"],
  env: {},
};

export type RegisterOutcome =
  | { readonly outcome: "registered" }
  | { readonly outcome: "failed"; readonly byHand: string };

export type UnregisterOutcome = "unregistered" | "not registered" | "no cli";

// A Host reports a failed remove as a value; the Hosts service turns it
// into a HostRemoveError, whose message needs the whole Host list.
export type UnregisterResult = UnregisterOutcome | "failed";

export type Borders = FileSystem.FileSystem | CommandExecutor.CommandExecutor;

export interface Host<N extends string = string> {
  readonly name: N;
  readonly label: string;
  readonly title: string;
  readonly manualAdd: string;
  readonly manualRemove: string;
  readonly detect: Effect.Effect<boolean, never, Borders>;
  readonly register: Effect.Effect<RegisterOutcome, never, Borders>;
  readonly unregister: Effect.Effect<UnregisterResult, never, Borders>;
}

// Whether a path under the home folder exists; read at run time, so a
// changed HOME is seen.
export const homeHas = (
  rel: string,
): Effect.Effect<boolean, never, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs
      .exists(join(homedir(), rel))
      .pipe(Effect.catchAll(() => Effect.succeed(false))),
  );
