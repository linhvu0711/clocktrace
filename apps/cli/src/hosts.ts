import { homedir } from "node:os";
import { join } from "node:path";

import { FileSystem } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import { Data, Effect, Either, Layer, Option } from "effect";

import { claudeHost } from "./claude-host.js";
import { codexHost } from "./codex-host.js";
import { removeRegistration, setRegistration } from "./hermes-config.js";
import {
  type Borders,
  type RegisterOutcome,
  serverEntry,
  serverNode,
  type UnregisterOutcome,
} from "./host.js";
import { openclawHost } from "./openclaw-host.js";

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

// The Hosts already in their own module; the rest still branch here.
const moved = {
  claude: claudeHost,
  codex: codexHost,
  openclaw: openclawHost,
} as const;

export const manualCommand: Record<HostName, string> = {
  claude: claudeHost.manualAdd,
  codex: codexHost.manualAdd,
  hermes: `add mcp_servers.clocktrace with command "${serverNode}" and args ["${serverEntry}", "mcp"] to ~/.hermes/config.yaml`,
  openclaw: openclawHost.manualAdd,
};

export const manualRemoveCommand: Record<HostName, string> = {
  claude: claudeHost.manualRemove,
  codex: codexHost.manualRemove,
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

const detectPath = { hermes: ".hermes" };

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
        const codex = yield* codexHost.detect;
        const openclaw = yield* openclawHost.detect;
        const hermes = yield* has(detectPath.hermes);
        return { claude, codex, hermes, openclaw };
      }),
    register: (
      host: HostName,
    ): Effect.Effect<RegisterOutcome, never, Borders> =>
      host === "hermes" ? registerHermes : moved[host].register,
    unregister: (
      host: HostName,
    ): Effect.Effect<UnregisterOutcome, HostRemoveError, Borders> =>
      host === "hermes"
        ? unregisterHermes
        : moved[host].unregister.pipe(
            Effect.flatMap((outcome) =>
              outcome === "failed"
                ? Effect.fail(new HostRemoveError({ host }))
                : Effect.succeed(outcome),
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
      register: () => Effect.succeed({ outcome: "registered" } as const),
      unregister: () => Effect.succeed("unregistered" as const),
    }),
  );
}
