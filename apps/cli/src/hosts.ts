import { homedir } from "node:os";
import { join } from "node:path";

import { Command, CommandExecutor, FileSystem } from "@effect/platform";
import { Chunk, Effect, Layer, Stream } from "effect";
import { parseDocument } from "yaml";

export const hostNames = ["claude", "codex", "hermes", "openclaw"] as const;

export type HostName = (typeof hostNames)[number];

export const hostLabel: Record<HostName, string> = {
  claude: "claude code",
  codex: "codex",
  hermes: "hermes agent",
  openclaw: "openclaw",
};

export const manualCommand: Record<HostName, string> = {
  claude: "claude mcp add --scope user clocktrace -- clocktrace mcp",
  codex: "codex mcp add clocktrace -- clocktrace mcp",
  hermes:
    'add mcp_servers.clocktrace with command "clocktrace" and args ["mcp"] to ~/.hermes/config.yaml',
  openclaw: "openclaw mcp add clocktrace --command clocktrace --arg mcp",
};

const addArgv: Record<Exclude<HostName, "hermes">, ReadonlyArray<string>> = {
  claude: [
    "mcp",
    "add",
    "--scope",
    "user",
    "clocktrace",
    "--",
    "clocktrace",
    "mcp",
  ],
  codex: ["mcp", "add", "clocktrace", "--", "clocktrace", "mcp"],
  openclaw: [
    "mcp",
    "add",
    "clocktrace",
    "--command",
    "clocktrace",
    "--arg",
    "mcp",
  ],
};

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

const runAdd = (
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

const registerHermes: Effect.Effect<string, never, FileSystem.FileSystem> =
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = join(homedir(), ".hermes", "config.yaml");
    const exists = yield* fs
      .exists(path)
      .pipe(Effect.catchAll(() => Effect.succeed(false)));
    const text = exists
      ? yield* fs.readFileString(path).pipe(Effect.orElseSucceed(() => ""))
      : "";
    const doc = parseDocument(text === "" ? "{}" : text);
    if (doc.getIn(["mcp_servers", "clocktrace"]) !== undefined) {
      return `${hostLabel.hermes}: already registered`;
    }
    doc.setIn(["mcp_servers", "clocktrace"], {
      command: "clocktrace",
      args: ["mcp"],
    });
    yield* fs
      .makeDirectory(join(homedir(), ".hermes"), { recursive: true })
      .pipe(Effect.orDie);
    yield* fs.writeFileString(path, doc.toString()).pipe(Effect.orDie);
    return `${hostLabel.hermes}: registered`;
  }).pipe(
    Effect.catchAll(() =>
      Effect.succeed(
        `${hostLabel.hermes}: failed. run by hand: ${manualCommand.hermes}`,
      ),
    ),
  );

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
        : runAdd(host, addArgv[host]).pipe(
            Effect.map(({ code, output }) =>
              code === 0
                ? `${hostLabel[host]}: registered`
                : /already|exists/i.test(output)
                  ? `${hostLabel[host]}: already registered`
                  : `${hostLabel[host]}: failed. run by hand: ${manualCommand[host]}`,
            ),
          ),
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
    }),
  );
}
