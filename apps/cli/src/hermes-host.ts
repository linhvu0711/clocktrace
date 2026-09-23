import { homedir } from "node:os";
import { join } from "node:path";

import { FileSystem } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import { Data, Effect, Either, Option } from "effect";

import { removeRegistration, setRegistration } from "./hermes-config.js";
import {
  type Host,
  homeHas,
  type RegisterOutcome,
  serverEntry,
  serverNode,
  type UnregisterResult,
} from "./host.js";

// Hermes has no CLI for MCP servers, so its Registration is written into
// ~/.hermes/config.yaml directly.
const hermesConfigPath = () => join(homedir(), ".hermes", "config.yaml");

const manualAdd = `add mcp_servers.clocktrace with command "${serverNode}" and args ["${serverEntry}", "mcp"] to ~/.hermes/config.yaml`;

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

const register: Effect.Effect<RegisterOutcome, never, FileSystem.FileSystem> =
  Effect.gen(function* () {
    yield* editHermes((text) =>
      setRegistration(text, {
        command: serverNode,
        args: [serverEntry, "mcp"],
      }).pipe(Either.map(Option.some)),
    );
    return { outcome: "registered" } as const;
  }).pipe(
    Effect.catchAll(() =>
      Effect.succeed({ outcome: "failed" as const, byHand: manualAdd }),
    ),
  );

const unregister: Effect.Effect<
  UnregisterResult,
  never,
  FileSystem.FileSystem
> = Effect.gen(function* () {
  const wrote = yield* editHermes(removeRegistration);
  return wrote ? ("unregistered" as const) : ("not registered" as const);
}).pipe(Effect.catchAll(() => Effect.succeed("failed" as const)));

export const hermesHost: Host<"hermes"> = {
  name: "hermes",
  label: "hermes agent",
  title: "Hermes Agent",
  manualAdd,
  manualRemove: "remove mcp_servers.clocktrace from ~/.hermes/config.yaml",
  detect: homeHas(".hermes"),
  register,
  unregister,
};
