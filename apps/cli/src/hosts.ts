import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Command, CommandExecutor, FileSystem } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import { Chunk, Data, Effect, Layer, Stream } from "effect";
import { type Document, parseDocument } from "yaml";

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

export const manualCommand: Record<HostName, string> = {
  claude: `claude mcp add --scope user clocktrace -- ${serverNode} ${serverEntry} mcp`,
  codex: `codex mcp add clocktrace -- ${serverNode} ${serverEntry} mcp`,
  hermes: `add mcp_servers.clocktrace with command "${serverNode}" and args ["${serverEntry}", "mcp"] to ~/.hermes/config.yaml`,
  openclaw: `openclaw mcp add clocktrace --command ${serverNode} --arg ${serverEntry} --arg mcp`,
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

const addArgv: Record<Exclude<HostName, "hermes">, ReadonlyArray<string>> = {
  claude: [
    "mcp",
    "add",
    "--scope",
    "user",
    "clocktrace",
    "--",
    serverNode,
    serverEntry,
    "mcp",
  ],
  codex: ["mcp", "add", "clocktrace", "--", serverNode, serverEntry, "mcp"],
  openclaw: [
    "mcp",
    "add",
    "clocktrace",
    "--command",
    serverNode,
    "--arg",
    serverEntry,
    "--arg",
    "mcp",
  ],
};

const removeArgv: Record<Exclude<HostName, "hermes">, ReadonlyArray<string>> = {
  claude: ["mcp", "remove", "clocktrace", "--scope", "user"],
  codex: ["mcp", "remove", "clocktrace"],
  openclaw: ["mcp", "unset", "clocktrace"],
};

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

const collect = (
  stream: Stream.Stream<Uint8Array, unknown>,
): Effect.Effect<string> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runCollect,
    Effect.map((chunk) => Chunk.toReadonlyArray(chunk).join("")),
    Effect.catchAll(() => Effect.succeed("")),
  );

const runHost = (
  bin: string,
  argv: ReadonlyArray<string>,
): Effect.Effect<
  { readonly code: number; readonly output: string },
  never,
  CommandExecutor.CommandExecutor
> =>
  Effect.scoped(
    Effect.gen(function* () {
      const executor = yield* CommandExecutor.CommandExecutor;
      const process = yield* executor.start(Command.make(bin, ...argv));
      const [stdout, stderr, code] = yield* Effect.all(
        [
          collect(process.stdout),
          collect(process.stderr),
          process.exitCode.pipe(
            Effect.catchAll(() =>
              Effect.succeed(1 as CommandExecutor.ExitCode),
            ),
          ),
        ],
        { concurrency: "unbounded" },
      );
      return { code, output: `${stdout}\n${stderr}` };
    }),
  ).pipe(Effect.catchAll(() => Effect.succeed({ code: 1, output: "" })));

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
  { readonly doc: Document; readonly exists: boolean },
  HermesConfigParseError | PlatformError,
  FileSystem.FileSystem
> = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = hermesConfigPath();
  const exists = yield* fs
    .exists(path)
    .pipe(Effect.catchAll(() => Effect.succeed(false)));
  const text = exists ? yield* fs.readFileString(path) : "";
  const doc = yield* Effect.try({
    try: () => parseDocument(text === "" ? "{}" : text),
    catch: (cause) => new HermesConfigParseError({ cause }),
  });
  if (doc.errors.length > 0) {
    return yield* new HermesConfigParseError({ cause: doc.errors });
  }
  return { doc, exists };
});

// Write beside the resolved target so a symlink keeps pointing at its
// source, and keep the target's mode on the replacement file.
const writeHermes = (
  doc: Document,
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
    yield* fs.writeFileString(tmp, doc.toString()).pipe(
      Effect.andThen(info === null ? Effect.void : fs.chmod(tmp, info.mode)),
      Effect.andThen(fs.rename(tmp, target)),
      Effect.tapError(() => fs.remove(tmp).pipe(Effect.ignore)),
    );
  });

const registerHermes: Effect.Effect<string, never, FileSystem.FileSystem> =
  Effect.gen(function* () {
    const { doc, exists } = yield* readHermes;
    doc.setIn(["mcp_servers", "clocktrace"], {
      command: serverNode,
      args: [serverEntry, "mcp"],
    });
    yield* writeHermes(doc, exists);
    return `${hostLabel.hermes}: registered`;
  }).pipe(
    Effect.catchAll(() =>
      Effect.succeed(
        `${hostLabel.hermes}: failed. run by hand: ${manualCommand.hermes}`,
      ),
    ),
  );

const unregisterHermes: Effect.Effect<
  UnregisterOutcome,
  HostRemoveError,
  FileSystem.FileSystem
> = Effect.gen(function* () {
  const { doc, exists } = yield* readHermes;
  if (doc.getIn(["mcp_servers", "clocktrace"]) === undefined) {
    return "not registered" as const;
  }
  doc.deleteIn(["mcp_servers", "clocktrace"]);
  yield* writeHermes(doc, exists);
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
    register: (host: HostName): Effect.Effect<string, never, Borders> =>
      host === "hermes"
        ? registerHermes
        : runHost(host, removeArgv[host]).pipe(
            Effect.andThen(runHost(host, addArgv[host])),
            Effect.map(({ code }) =>
              code === 0
                ? `${hostLabel[host]}: registered`
                : `${hostLabel[host]}: failed. run by hand: ${manualCommand[host]}`,
            ),
          ),
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
            const { code, output } = yield* runHost(host, removeArgv[host]);
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
      register: (host) => Effect.succeed(`${hostLabel[host]}: registered`),
      unregister: () => Effect.succeed("unregistered" as const),
    }),
  );
}
