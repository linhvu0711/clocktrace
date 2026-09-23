import { homedir } from "node:os";
import { join } from "node:path";

import { Command, type CommandExecutor, FileSystem } from "@effect/platform";
import { Effect } from "effect";

import { shellQuote } from "./format.js";
import {
  type Host,
  homeHas,
  type Registration,
  serverRegistration,
} from "./host.js";
import { runCommand } from "./run-command.js";

// What a Host with its own CLI gives: its words, where it keeps its
// config, and how its CLI adds, removes, and says it has no clocktrace.
export interface CliHostSpec<N extends string> {
  // Also the binary on PATH.
  readonly name: N;
  readonly label: string;
  readonly title: string;
  // Under home; found there, the Host counts as installed.
  readonly detectPath: string;
  // Under home; read only, the Host CLI writes it.
  readonly configFile: string;
  readonly readPrior: (text: string) => Registration | null;
  // `quote` wraps each variable word: none for the argv to run, a shell
  // quote for the line a person runs by hand.
  readonly addArgv: (
    registration: Registration,
    quote: (word: string) => string,
  ) => ReadonlyArray<string>;
  readonly removeArgv: ReadonlyArray<string>;
  readonly notRegistered: RegExp;
}

export const envPairs = (env: Readonly<Record<string, string>>) =>
  Object.entries(env).map(([k, v]) => `${k}=${v}`);

// What a host CLI prints when asked to remove a server it does not have;
// codex exits 0 in that case, so the text is checked before the code.
export const noServerNamedClocktrace =
  /no mcp server named ['"]?clocktrace['"]?/i;

export const dig = (doc: unknown, path: ReadonlyArray<string>): unknown =>
  path.reduce<unknown>(
    (acc, key) =>
      typeof acc === "object" && acc !== null
        ? (acc as Record<string, unknown>)[key]
        : undefined,
    doc,
  );

// A map of strings, or null when any value is not one.
const stringRecord = (value: unknown): Record<string, string> | null => {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== "string") {
      return null;
    }
    out[k] = v;
  }
  return out;
};

// A failed add must not strand a working registration: before removing we
// read the entry the host already has, so it can go back through the same
// add command. Only an entry whose every field the add command can express
// again is restorable; url transports, cwd, and other extras restore
// nothing rather than restore a subtly wrong entry.
export const stdioPrior = (value: unknown): Registration | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.command !== "string" ||
    ("type" in entry && entry.type !== "stdio") ||
    ("transport" in entry && entry.transport !== "stdio") ||
    Object.keys(entry).some(
      (k) => !["command", "args", "env", "type", "transport"].includes(k),
    )
  ) {
    return null;
  }
  if (
    entry.args !== undefined &&
    (!Array.isArray(entry.args) ||
      entry.args.some((a) => typeof a !== "string"))
  ) {
    return null;
  }
  const env = stringRecord(entry.env);
  if (env === null) {
    return null;
  }
  return {
    command: entry.command,
    args: (entry.args as ReadonlyArray<string> | undefined) ?? [],
    env,
  };
};

export const jsonPrior =
  (path: ReadonlyArray<string>) =>
  (text: string): Registration | null => {
    try {
      return stdioPrior(dig(JSON.parse(text), path));
    } catch {
      return null;
    }
  };

const onPath = (
  bin: string,
): Effect.Effect<boolean, never, CommandExecutor.CommandExecutor> =>
  Command.make("which", bin).pipe(
    Command.exitCode,
    Effect.map((code) => code === 0),
    Effect.catchAll(() => Effect.succeed(false)),
  );

const asIs = (word: string) => word;

export const cliHost = <N extends string>(spec: CliHostSpec<N>): Host<N> => {
  const { name, addArgv, removeArgv } = spec;
  const byHand = (registration: Registration) =>
    [name, ...addArgv(registration, shellQuote)].join(" ");
  const readPrior = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs
      .readFileString(join(homedir(), spec.configFile))
      .pipe(Effect.catchAll(() => Effect.succeed("")));
    return text === "" ? null : spec.readPrior(text);
  });
  return {
    name,
    label: spec.label,
    title: spec.title,
    manualAdd: byHand(serverRegistration),
    manualRemove: [name, ...removeArgv].join(" "),
    detect: Effect.gen(function* () {
      return (yield* onPath(name)) || (yield* homeHas(spec.detectPath));
    }),
    register: Effect.gen(function* () {
      const prior = yield* readPrior;
      yield* runCommand(name, removeArgv);
      const next: Registration = {
        ...serverRegistration,
        env: prior?.env ?? {},
      };
      const { code } = yield* runCommand(name, addArgv(next, asIs));
      if (code === 0) {
        return { outcome: "registered" } as const;
      }
      if (prior !== null) {
        yield* runCommand(name, addArgv(prior, asIs));
      }
      return { outcome: "failed" as const, byHand: byHand(next) };
    }),
    unregister: Effect.gen(function* () {
      // detect can find a host by its config alone; without the
      // binary the remove can never run, so say so instead of failing.
      if (!(yield* onPath(name))) {
        return "no cli" as const;
      }
      const { code, output } = yield* runCommand(name, removeArgv);
      if (spec.notRegistered.test(output)) {
        return "not registered" as const;
      }
      return code === 0 ? ("unregistered" as const) : ("failed" as const);
    }),
  };
};
