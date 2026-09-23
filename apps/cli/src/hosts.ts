import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Command, type CommandExecutor, FileSystem } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import { Data, Effect, Layer } from "effect";
import { parseDocument } from "yaml";

import { shellQuote } from "./format.js";
import { setRegistration } from "./hermes-config.js";
import { runCommand } from "./run-command.js";

export const hostNames = ["claude", "codex", "hermes", "openclaw"] as const;

export type HostName = (typeof hostNames)[number];

export class UnknownHostError extends Data.TaggedError("UnknownHostError")<{
  readonly names: ReadonlyArray<string>;
}> {
  override get message(): string {
    return this.names.length === 0
      ? "--hosts needs at least one name"
      : `unknown host: ${this.names.join(", ")}`;
  }
}

export const hostLabel: Record<HostName, string> = {
  claude: "claude code",
  codex: "codex",
  hermes: "hermes agent",
  openclaw: "openclaw",
};

// A Host started from the Dock sees only the system PATH, so every
// Registration names the running node and the bin by absolute path —
// the same shape the launchd plist uses (ADR 0008).
export const serverNode = process.execPath;

export const serverEntry = fileURLToPath(
  new URL("../bin/clocktrace.js", import.meta.url),
);

export const hostTitle: Record<HostName, string> = {
  claude: "Claude Code",
  codex: "Codex",
  hermes: "Hermes Agent",
  openclaw: "OpenClaw",
};

type CliHost = Exclude<HostName, "hermes">;

// The shape a host add command can express; a registration carrying any
// other field cannot be restored through it.
type Registration = {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string>>;
};

const serverRegistration: Registration = {
  command: serverNode,
  args: [serverEntry, "mcp"],
  env: {},
};

const envPairs = (env: Readonly<Record<string, string>>) =>
  Object.entries(env).map(([k, v]) => `${k}=${v}`);

const addArgvFor = (
  host: CliHost,
  { command, args, env }: Registration,
): ReadonlyArray<string> => {
  const pairs = envPairs(env);
  return host === "claude"
    ? [
        "mcp",
        "add",
        "--scope",
        "user",
        "clocktrace",
        ...pairs.flatMap((p) => ["-e", p]),
        "--",
        command,
        ...args,
      ]
    : host === "codex"
      ? [
          "mcp",
          "add",
          "clocktrace",
          ...pairs.flatMap((p) => ["--env", p]),
          "--",
          command,
          ...args,
        ]
      : [
          "mcp",
          "add",
          "clocktrace",
          "--command",
          command,
          ...pairs.flatMap((p) => ["--env", p]),
          ...args.flatMap((a) => ["--arg", a]),
        ];
};

// The same add argv as one shell line for a person to run by hand. Variable
// words are always quoted so the printed command is safe on any machine.
const addCommandFor = (
  host: CliHost,
  { command, args, env }: Registration,
): string => {
  const words =
    host === "claude"
      ? [
          "claude",
          "mcp",
          "add",
          "--scope",
          "user",
          "clocktrace",
          ...envPairs(env).flatMap((p) => ["-e", shellQuote(p)]),
          "--",
          shellQuote(command),
          ...args.map(shellQuote),
        ]
      : host === "codex"
        ? [
            "codex",
            "mcp",
            "add",
            "clocktrace",
            ...envPairs(env).flatMap((p) => ["--env", shellQuote(p)]),
            "--",
            shellQuote(command),
            ...args.map(shellQuote),
          ]
        : [
            "openclaw",
            "mcp",
            "add",
            "clocktrace",
            "--command",
            shellQuote(command),
            ...envPairs(env).flatMap((p) => ["--env", shellQuote(p)]),
            ...args.flatMap((a) => ["--arg", shellQuote(a)]),
          ];
  return words.join(" ");
};

export const manualCommand: Record<HostName, string> = {
  claude: addCommandFor("claude", serverRegistration),
  codex: addCommandFor("codex", serverRegistration),
  hermes: `add mcp_servers.clocktrace with command "${serverNode}" and args ["${serverEntry}", "mcp"] to ~/.hermes/config.yaml`,
  openclaw: addCommandFor("openclaw", serverRegistration),
};

export const manualRemoveCommand: Record<HostName, string> = {
  claude: "claude mcp remove clocktrace --scope user",
  codex: "codex mcp remove clocktrace",
  hermes: "remove mcp_servers.clocktrace from ~/.hermes/config.yaml",
  openclaw: "openclaw mcp unset clocktrace",
};

export class HostRemoveError extends Data.TaggedError("HostRemoveError")<{
  readonly host: HostName;
}> {
  override get message(): string {
    return `${hostTitle[this.host]} failed · run by hand: ${manualRemoveCommand[this.host]}`;
  }
}

const removeArgv: Record<CliHost, ReadonlyArray<string>> = {
  claude: ["mcp", "remove", "clocktrace", "--scope", "user"],
  codex: ["mcp", "remove", "clocktrace"],
  openclaw: ["mcp", "unset", "clocktrace"],
};

// A failed add must not strand a working registration: before removing we
// read the entry the host already has, so it can go back through the same
// add command. The files are read-only here — only the host CLI writes.
type PriorRegistration = Registration;

const dig = (doc: unknown, path: ReadonlyArray<string>): unknown =>
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

// Only an entry whose every field the add command can express again is
// restorable; url transports, cwd, and other extras restore nothing rather
// than restore a subtly wrong entry.
const stdioPrior = (value: unknown): PriorRegistration | null => {
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

const jsonPrior =
  (path: ReadonlyArray<string>) =>
  (text: string): PriorRegistration | null => {
    try {
      return stdioPrior(dig(JSON.parse(text), path));
    } catch {
      return null;
    }
  };

const unescapeToml = (s: string): string =>
  s.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/gs, (_, e: string) => {
    switch (e[0]) {
      case "u":
      case "U":
        return String.fromCodePoint(Number.parseInt(e.slice(1), 16));
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      case "b":
        return "\b";
      case "f":
        return "\f";
      default:
        return e;
    }
  });

const tomlString = /"((?:[^"\\]|\\.)*)"/g;

// The lines of a [name] table, up to the next table header.
const tomlTable = (text: string, name: string): string | null => {
  const header = new RegExp(`^[ \\t]*\\[${name}\\][ \\t]*$`, "m").exec(text);
  if (header === null) {
    return null;
  }
  const rest = text.slice(header.index + header[0].length);
  const next = /^[ \t]*\[/m.exec(rest);
  return next === null ? rest : rest.slice(0, next.index);
};

// Codex writes a [mcp_servers.clocktrace] table plus an optional
// [mcp_servers.clocktrace.env] sub-table. Any other key or sub-table is a
// field the add command cannot rebuild, so the entry is not restorable.
const codexPrior = (text: string): PriorRegistration | null => {
  if (/^[ \t]*\[mcp_servers\.clocktrace\.(?!env\])/m.test(text)) {
    return null;
  }
  const block = tomlTable(text, "mcp_servers\\.clocktrace");
  if (block === null) {
    return null;
  }
  const keys = block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
  if (keys.some((l) => !/^(command|args)[ \t]*=/.test(l))) {
    return null;
  }
  const command = /^[ \t]*command[ \t]*=[ \t]*"((?:[^"\\]|\\.)*)"/m.exec(
    block,
  )?.[1];
  if (command === undefined) {
    return null;
  }
  const argsText = /^[ \t]*args[ \t]*=[ \t]*\[([\s\S]*?)\]/m.exec(block)?.[1];
  const env: Record<string, string> = {};
  const envBlock = tomlTable(text, "mcp_servers\\.clocktrace\\.env");
  if (envBlock !== null) {
    for (const raw of envBlock.split("\n")) {
      const line = raw.trim();
      if (line === "" || line.startsWith("#")) {
        continue;
      }
      const pair =
        /^([A-Za-z0-9_.-]+)[ \t]*=[ \t]*"((?:[^"\\]|\\.)*)"[ \t]*(#[^\n]*)?$/.exec(
          line,
        );
      if (pair === null || pair[1] === undefined || pair[2] === undefined) {
        return null;
      }
      env[pair[1]] = unescapeToml(pair[2]);
    }
  }
  return {
    command: unescapeToml(command),
    args:
      argsText === undefined
        ? []
        : [...argsText.matchAll(tomlString)].flatMap((m) =>
            m[1] === undefined ? [] : [unescapeToml(m[1])],
          ),
    env,
  };
};

const priorConfig: Record<
  CliHost,
  { file: string; read: (text: string) => PriorRegistration | null }
> = {
  claude: {
    file: ".claude.json",
    read: jsonPrior(["mcpServers", "clocktrace"]),
  },
  codex: {
    file: join(".codex", "config.toml"),
    read: codexPrior,
  },
  openclaw: {
    file: join(".openclaw", "openclaw.json"),
    read: jsonPrior(["mcp", "servers", "clocktrace"]),
  },
};

const readPrior = (
  host: CliHost,
): Effect.Effect<PriorRegistration | null, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { file, read } = priorConfig[host];
    const text = yield* fs
      .readFileString(join(homedir(), file))
      .pipe(Effect.catchAll(() => Effect.succeed("")));
    return text === "" ? null : read(text);
  });

export type UnregisterOutcome = "unregistered" | "not registered" | "no cli";

// What a host CLI prints when asked to remove a server it does not have;
// codex exits 0 in that case, so the text is checked before the code.
const notRegisteredPattern = /no mcp server named ['"]?clocktrace['"]?/i;

const detectPath: Record<HostName, string> = {
  claude: ".claude.json",
  codex: ".codex",
  hermes: ".hermes",
  openclaw: ".openclaw",
};

type Borders = FileSystem.FileSystem | CommandExecutor.CommandExecutor;

const onPath = (
  bin: string,
): Effect.Effect<boolean, never, CommandExecutor.CommandExecutor> =>
  Command.make("which", bin).pipe(
    Command.exitCode,
    Effect.map((code) => code === 0),
    Effect.catchAll(() => Effect.succeed(false)),
  );

class HermesConfigParseError extends Data.TaggedError(
  "HermesConfigParseError",
)<{
  cause: unknown;
}> {}

const hermesConfigPath = () => join(homedir(), ".hermes", "config.yaml");

const readHermes: Effect.Effect<
  { readonly text: string; readonly exists: boolean },
  PlatformError,
  FileSystem.FileSystem
> = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = hermesConfigPath();
  const exists = yield* fs
    .exists(path)
    .pipe(Effect.catchAll(() => Effect.succeed(false)));
  const text = exists ? yield* fs.readFileString(path) : "";
  return { text, exists };
});

// Write beside the resolved target so a symlink keeps pointing at its
// source, and keep the target's mode on the replacement file.
const writeHermes = (
  text: string,
  exists: boolean,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = hermesConfigPath();
    const target = exists
      ? yield* fs
          .realPath(path)
          .pipe(Effect.catchAll(() => Effect.succeed(path)))
      : path;
    const info = exists
      ? yield* fs.stat(target).pipe(Effect.catchAll(() => Effect.succeed(null)))
      : null;
    yield* fs.makeDirectory(join(homedir(), ".hermes"), { recursive: true });
    const tmp = `${target}.tmp`;
    yield* fs.writeFileString(tmp, text).pipe(
      Effect.andThen(info === null ? Effect.void : fs.chmod(tmp, info.mode)),
      Effect.andThen(fs.rename(tmp, target)),
      Effect.tapError(() => fs.remove(tmp).pipe(Effect.ignore)),
    );
  });

export type RegisterOutcome =
  | { readonly outcome: "registered" }
  | { readonly outcome: "failed"; readonly byHand: string };

const registerHermes: Effect.Effect<
  RegisterOutcome,
  never,
  FileSystem.FileSystem
> = Effect.gen(function* () {
  const { text, exists } = yield* readHermes;
  const next = yield* setRegistration(text, {
    command: serverNode,
    args: [serverEntry, "mcp"],
  });
  yield* writeHermes(next, exists);
  return { outcome: "registered" } as const;
}).pipe(
  Effect.catchAll(() =>
    Effect.succeed({
      outcome: "failed" as const,
      byHand: manualCommand.hermes,
    }),
  ),
);

const unregisterHermes: Effect.Effect<
  UnregisterOutcome,
  HostRemoveError,
  FileSystem.FileSystem
> = Effect.gen(function* () {
  const { text, exists } = yield* readHermes;
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    return yield* new HermesConfigParseError({ cause: doc.errors });
  }
  if (doc.getIn(["mcp_servers", "clocktrace"]) === undefined) {
    return "not registered" as const;
  }
  doc.deleteIn(["mcp_servers", "clocktrace"]);
  yield* writeHermes(doc.toString(), exists);
  return "unregistered" as const;
}).pipe(Effect.mapError(() => new HostRemoveError({ host: "hermes" })));

export class Hosts extends Effect.Service<Hosts>()("Hosts", {
  succeed: {
    detect: (): Effect.Effect<Record<HostName, boolean>, never, Borders> =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const has = (rel: string) =>
          fs
            .exists(join(homedir(), rel))
            .pipe(Effect.catchAll(() => Effect.succeed(false)));
        const claude =
          (yield* onPath("claude")) || (yield* has(detectPath.claude));
        const codex =
          (yield* onPath("codex")) || (yield* has(detectPath.codex));
        const openclaw =
          (yield* onPath("openclaw")) || (yield* has(detectPath.openclaw));
        const hermes = yield* has(detectPath.hermes);
        return { claude, codex, hermes, openclaw };
      }),
    register: (
      host: HostName,
    ): Effect.Effect<RegisterOutcome, never, Borders> =>
      host === "hermes"
        ? registerHermes
        : Effect.gen(function* () {
            const prior = yield* readPrior(host);
            yield* runCommand(host, removeArgv[host]);
            const next: Registration = {
              ...serverRegistration,
              env: prior?.env ?? {},
            };
            const { code } = yield* runCommand(host, addArgvFor(host, next));
            if (code === 0) {
              return { outcome: "registered" } as const;
            }
            if (prior !== null) {
              yield* runCommand(host, addArgvFor(host, prior));
            }
            return {
              outcome: "failed" as const,
              byHand: addCommandFor(host, next),
            };
          }),
    unregister: (
      host: HostName,
    ): Effect.Effect<UnregisterOutcome, HostRemoveError, Borders> =>
      host === "hermes"
        ? unregisterHermes
        : Effect.gen(function* () {
            // detect can find a host by its config alone; without the
            // binary the remove can never run, so say so instead of failing.
            if (!(yield* onPath(host))) {
              return "no cli" as const;
            }
            const { code, output } = yield* runCommand(host, removeArgv[host]);
            if (notRegisteredPattern.test(output)) {
              return "not registered" as const;
            }
            if (code === 0) {
              return "unregistered" as const;
            }
            return yield* new HostRemoveError({ host });
          }),
  },
}) {
  // biome-ignore lint/style/useNamingConvention: layers are PascalCase
  static Test = Layer.succeed(
    this,
    new Hosts({
      detect: () =>
        Effect.succeed({
          claude: false,
          codex: false,
          hermes: false,
          openclaw: false,
        }),
      register: () => Effect.succeed({ outcome: "registered" } as const),
      unregister: () => Effect.succeed("unregistered" as const),
    }),
  );
}
