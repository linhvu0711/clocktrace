import { homedir } from "node:os";
import { join } from "node:path";

import { Command, type CommandExecutor, FileSystem } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import { Data, Effect, Either, Layer, Option } from "effect";

import { claudeHost } from "./claude-host.js";
import { envPairs, noServerNamedClocktrace } from "./cli-host.js";
import { shellQuote } from "./format.js";
import { removeRegistration, setRegistration } from "./hermes-config.js";
import {
  type Borders,
  type RegisterOutcome,
  type Registration,
  serverEntry,
  serverNode,
  serverRegistration,
  type UnregisterOutcome,
} from "./host.js";
import { openclawHost } from "./openclaw-host.js";
import { runCommand } from "./run-command.js";

export { serverEntry, serverNode } from "./host.js";

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

export const hostTitle: Record<HostName, string> = {
  claude: "Claude Code",
  codex: "Codex",
  hermes: "Hermes Agent",
  openclaw: "OpenClaw",
};

type CliHost = "codex";

// The Hosts already in their own module; the rest still branch here.
const moved = { claude: claudeHost, openclaw: openclawHost } as const;

const isMoved = (host: HostName): host is keyof typeof moved => host in moved;

const addArgvFor = (
  _host: CliHost,
  { command, args, env }: Registration,
): ReadonlyArray<string> => {
  const pairs = envPairs(env);
  return [
    "mcp",
    "add",
    "clocktrace",
    ...pairs.flatMap((p) => ["--env", p]),
    "--",
    command,
    ...args,
  ];
};

// The same add argv as one shell line for a person to run by hand. Variable
// words are always quoted so the printed command is safe on any machine.
const addCommandFor = (
  host: CliHost,
  { command, args, env }: Registration,
): string => {
  const words = [
    host,
    "mcp",
    "add",
    "clocktrace",
    ...envPairs(env).flatMap((p) => ["--env", shellQuote(p)]),
    "--",
    shellQuote(command),
    ...args.map(shellQuote),
  ];
  return words.join(" ");
};

export const manualCommand: Record<HostName, string> = {
  claude: claudeHost.manualAdd,
  codex: addCommandFor("codex", serverRegistration),
  hermes: `add mcp_servers.clocktrace with command "${serverNode}" and args ["${serverEntry}", "mcp"] to ~/.hermes/config.yaml`,
  openclaw: openclawHost.manualAdd,
};

export const manualRemoveCommand: Record<HostName, string> = {
  claude: claudeHost.manualRemove,
  codex: "codex mcp remove clocktrace",
  hermes: "remove mcp_servers.clocktrace from ~/.hermes/config.yaml",
  openclaw: openclawHost.manualRemove,
};

export class HostRemoveError extends Data.TaggedError("HostRemoveError")<{
  readonly host: HostName;
}> {
  override get message(): string {
    return `${hostTitle[this.host]} failed · run by hand: ${manualRemoveCommand[this.host]}`;
  }
}

const removeArgv: Record<CliHost, ReadonlyArray<string>> = {
  codex: ["mcp", "remove", "clocktrace"],
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
const codexPrior = (text: string): Registration | null => {
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
  { file: string; read: (text: string) => Registration | null }
> = {
  codex: {
    file: join(".codex", "config.toml"),
    read: codexPrior,
  },
};

const readPrior = (
  host: CliHost,
): Effect.Effect<Registration | null, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { file, read } = priorConfig[host];
    const text = yield* fs
      .readFileString(join(homedir(), file))
      .pipe(Effect.catchAll(() => Effect.succeed("")));
    return text === "" ? null : read(text);
  });

const detectPath: Record<"codex" | "hermes", string> = {
  codex: ".codex",
  hermes: ".hermes",
};

const onPath = (
  bin: string,
): Effect.Effect<boolean, never, CommandExecutor.CommandExecutor> =>
  Command.make("which", bin).pipe(
    Command.exitCode,
    Effect.map((code) => code === 0),
    Effect.catchAll(() => Effect.succeed(false)),
  );

const hermesConfigPath = () => join(homedir(), ".hermes", "config.yaml");

interface HermesRead {
  readonly text: string;
  readonly exists: boolean;
}

// The file no longer holds what was read: another writer saved in between.
class HermesConfigChangedError extends Data.TaggedError(
  "HermesConfigChangedError",
) {}

const readHermes: Effect.Effect<
  HermesRead,
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
// Just before the rename, the file must still hold what was read, or a save
// by Hermes or the user would be lost. Hermes takes no lock, so a save can
// still land between that compare and the rename, a window of microseconds.
const writeHermes = (
  read: HermesRead,
  text: string,
): Effect.Effect<
  void,
  HermesConfigChangedError | PlatformError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = hermesConfigPath();
    const target = read.exists
      ? yield* fs
          .realPath(path)
          .pipe(Effect.catchAll(() => Effect.succeed(path)))
      : path;
    const info = read.exists
      ? yield* fs.stat(target).pipe(Effect.catchAll(() => Effect.succeed(null)))
      : null;
    yield* fs.makeDirectory(join(homedir(), ".hermes"), { recursive: true });
    const tmp = `${target}.tmp`;
    const unchanged = Effect.flatMap(readHermes, (now) =>
      now.exists === read.exists && now.text === read.text
        ? Effect.void
        : new HermesConfigChangedError(),
    );
    yield* fs.writeFileString(tmp, text).pipe(
      Effect.andThen(info === null ? Effect.void : fs.chmod(tmp, info.mode)),
      Effect.andThen(unchanged),
      Effect.andThen(fs.rename(tmp, target)),
      Effect.tapError(() => fs.remove(tmp).pipe(Effect.ignore)),
    );
  });

// Read, edit, write; a save that lands in between starts it over on the new
// text, up to three tries. An edit that returns none writes nothing, and
// the result says whether a write happened.
const editHermes = <E>(
  edit: (text: string) => Either.Either<Option.Option<string>, E>,
): Effect.Effect<
  boolean,
  E | HermesConfigChangedError | PlatformError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const read = yield* readHermes;
    const next = yield* edit(read.text);
    if (Option.isNone(next)) {
      return false;
    }
    yield* writeHermes(read, next.value);
    return true;
  }).pipe(
    Effect.retry({
      times: 2,
      while: (e) => e instanceof HermesConfigChangedError,
    }),
  );

const registerHermes: Effect.Effect<
  RegisterOutcome,
  never,
  FileSystem.FileSystem
> = Effect.gen(function* () {
  yield* editHermes((text) =>
    setRegistration(text, {
      command: serverNode,
      args: [serverEntry, "mcp"],
    }).pipe(Either.map(Option.some)),
  );
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
  const wrote = yield* editHermes(removeRegistration);
  return wrote ? ("unregistered" as const) : ("not registered" as const);
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
        const claude = yield* claudeHost.detect;
        const codex =
          (yield* onPath("codex")) || (yield* has(detectPath.codex));
        const openclaw = yield* openclawHost.detect;
        const hermes = yield* has(detectPath.hermes);
        return { claude, codex, hermes, openclaw };
      }),
    register: (
      host: HostName,
    ): Effect.Effect<RegisterOutcome, never, Borders> =>
      host === "hermes"
        ? registerHermes
        : isMoved(host)
          ? moved[host].register
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
        : isMoved(host)
          ? moved[host].unregister.pipe(
              Effect.flatMap((outcome) =>
                outcome === "failed"
                  ? Effect.fail(new HostRemoveError({ host }))
                  : Effect.succeed(outcome),
              ),
            )
          : Effect.gen(function* () {
              // detect can find a host by its config alone; without the
              // binary the remove can never run, so say so instead of failing.
              if (!(yield* onPath(host))) {
                return "no cli" as const;
              }
              const { code, output } = yield* runCommand(
                host,
                removeArgv[host],
              );
              if (noServerNamedClocktrace.test(output)) {
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
