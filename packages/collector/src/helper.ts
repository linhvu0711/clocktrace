import { join } from "node:path";

import { Command, CommandExecutor, FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Chunk, Data, Effect, Layer, Option, type Scope, Stream } from "effect";
import type { ParseError } from "effect/ParseResult";

import {
  type BiomeLine,
  type DevicePeerLine,
  decodeBiomeLine,
  decodeDevicePeerLine,
} from "./biome-line.js";
import { decodeHelperLine, type HelperLine } from "./helper-line.js";
import {
  decodePermissions,
  decodeRequestOutcome,
  type GrantRequest,
  requestArgs,
} from "./permissions.js";

export class HelperNotFoundError extends Data.TaggedError(
  "HelperNotFoundError",
)<{
  readonly path: string;
}> {
  override get message(): string {
    return `helper not found at ${this.path} · run pnpm build or set CLOCKTRACE_HELPER`;
  }
}

export class HelperExitedError extends Data.TaggedError("HelperExitedError")<{
  readonly cause: unknown;
}> {
  override get message(): string {
    return `helper exited: ${this.cause}`;
  }
}

export class NoFullDiskAccessError extends Data.TaggedError(
  "NoFullDiskAccessError",
) {
  override get message(): string {
    return "full disk access missing";
  }
}

export class DeviceListUnreadableError extends Data.TaggedError(
  "DeviceListUnreadableError",
)<{
  readonly reason: string;
}> {
  override get message(): string {
    return this.reason;
  }
}

export class HelperFailedError extends Data.TaggedError("HelperFailedError")<{
  readonly code: number;
  readonly stderr: string;
}> {
  override get message(): string {
    const text = this.stderr.trim();
    return text === ""
      ? `helper failed with exit code ${this.code}`
      : `helper failed with exit code ${this.code}: ${text}`;
  }
}

export class NoBiomeFolderError extends Data.TaggedError("NoBiomeFolderError")<{
  readonly reason: string;
}> {
  override get message(): string {
    return this.reason;
  }
}

export class FoldersUnreadableError extends Data.TaggedError(
  "FoldersUnreadableError",
)<{
  readonly records: ReadonlyArray<BiomeLine>;
  readonly reason: string;
}> {
  override get message(): string {
    return this.reason;
  }
}

interface BiomeOutput {
  readonly code: number;
  readonly lines: ReadonlyArray<string>;
  readonly stderr: string;
}

// `biome devices` exits 3 without Full Disk Access and 5 when the DevicePeer
// table cannot be read (packages/helper/README.md).
const devicesResult = ({
  code,
  lines,
  stderr,
}: BiomeOutput): Effect.Effect<
  ReadonlyArray<DevicePeerLine>,
  | NoFullDiskAccessError
  | DeviceListUnreadableError
  | HelperFailedError
  | ParseError
> => {
  switch (code) {
    case 0:
      return Effect.forEach(lines, (l) => decodeDevicePeerLine(l));
    case 3:
      return Effect.fail(new NoFullDiskAccessError());
    case 5:
      return Effect.fail(
        new DeviceListUnreadableError({ reason: stderr.trim() }),
      );
    default:
      return Effect.fail(new HelperFailedError({ code, stderr }));
  }
};

// `biome records` exits 3 without Full Disk Access, 4 without the remote
// folder, and 6 when a device folder cannot be listed; the other devices'
// records still print (packages/helper/README.md).
const recordsResult = ({
  code,
  lines,
  stderr,
}: BiomeOutput): Effect.Effect<
  ReadonlyArray<BiomeLine>,
  | NoFullDiskAccessError
  | NoBiomeFolderError
  | FoldersUnreadableError
  | HelperFailedError
  | ParseError
> => {
  switch (code) {
    case 0:
      return Effect.forEach(lines, (l) => decodeBiomeLine(l));
    case 3:
      return Effect.fail(new NoFullDiskAccessError());
    case 4:
      return Effect.fail(new NoBiomeFolderError({ reason: stderr.trim() }));
    case 6:
      return Effect.forEach(lines, (l) => decodeBiomeLine(l)).pipe(
        Effect.flatMap((records) =>
          Effect.fail(
            new FoldersUnreadableError({
              records,
              reason: stderr.trim() || "some device folders unreadable",
            }),
          ),
        ),
      );
    default:
      return Effect.fail(new HelperFailedError({ code, stderr }));
  }
};

export const sinceArgs = (
  since: ReadonlyMap<string, number>,
): ReadonlyArray<string> =>
  [...since.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([device, seconds]) => [
      "--since",
      `${device}=${Math.floor(seconds)}`,
    ]);

// The `open` flags the Helper is always run under: wait for the app,
// launch a fresh instance so its stdout is the app's own, and capture
// that stdout/stderr into files because `open` is not a pipe.
export const openArgs = (
  app: string,
  stdoutPath: string,
  stderrPath: string,
  args: ReadonlyArray<string>,
): ReadonlyArray<string> => [
  "-W",
  "-n",
  "--stdout",
  stdoutPath,
  "--stderr",
  stderrPath,
  "-a",
  app,
  "--args",
  ...args,
];

export class Helper extends Effect.Service<Helper>()("Helper", {
  effect: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const executor = yield* CommandExecutor.CommandExecutor;
    const runBiome = (
      command: Command.Command,
    ): Effect.Effect<BiomeOutput, HelperExitedError> =>
      Effect.scoped(
        Effect.gen(function* () {
          const process = yield* executor.start(command);
          const [lines, stderr, code] = yield* Effect.all(
            [
              process.stdout.pipe(
                Stream.decodeText(),
                Stream.splitLines,
                Stream.runCollect,
                Effect.map(Chunk.toReadonlyArray),
              ),
              process.stderr.pipe(
                Stream.decodeText(),
                Stream.runCollect,
                Effect.map((chunk) => Chunk.toReadonlyArray(chunk).join("")),
              ),
              process.exitCode,
            ],
            { concurrency: "unbounded" },
          );
          return { code, lines: lines.filter((l) => l !== ""), stderr };
        }),
      ).pipe(Effect.mapError((cause) => new HelperExitedError({ cause })));
    return {
      check: (path: string) =>
        fs.exists(path).pipe(
          Effect.mapError(() => new HelperNotFoundError({ path })),
          Effect.flatMap((exists) =>
            exists
              ? Effect.void
              : Effect.fail(new HelperNotFoundError({ path })),
          ),
        ),
      lines: (path: string): Stream.Stream<HelperLine, HelperExitedError> =>
        Command.make(path, "watch").pipe(
          Command.stderr("inherit"),
          Command.streamLines,
          Stream.provideService(CommandExecutor.CommandExecutor, executor),
          Stream.mapError((cause) => new HelperExitedError({ cause })),
          Stream.mapEffect((text) =>
            decodeHelperLine(text).pipe(
              Effect.map(Option.some),
              Effect.catchTag("ParseError", () =>
                Effect.logWarning("helper line rejected").pipe(
                  Effect.as(Option.none()),
                ),
              ),
            ),
          ),
          Stream.filterMap((o) => o),
          Stream.concat(
            Stream.fail(
              new HelperExitedError({ cause: "helper stdout closed" }),
            ),
          ),
        ),
      // `open -W` swallows the app's exit code, so both calls read the
      // Helper's report back from a captured stdout file.
      permissions: (app: string) =>
        viaOpen(app, ["permissions"]).pipe(Effect.flatMap(decodePermissions)),
      request: (app: string, grant: GrantRequest) =>
        viaOpen(app, ["permissions", "request", ...requestArgs(grant)]).pipe(
          Effect.flatMap(decodeRequestOutcome),
          Effect.map((line) => line.outcome),
        ),
      biomeDevices: (path: string) =>
        runBiome(Command.make(path, "biome", "devices")).pipe(
          Effect.flatMap(devicesResult),
        ),
      biomeRecords: (path: string, since: ReadonlyMap<string, number>) =>
        runBiome(
          Command.make(path, "biome", "records", ...sinceArgs(since)),
        ).pipe(Effect.flatMap(recordsResult)),
    };

    // Runs the Helper as ~/Applications/Clocktrace.app and returns what it
    // printed on stdout. A non-zero `open` exit with an empty stdout file
    // means macOS never ran the Helper. A non-zero exit with a line in the
    // file means `open -W` lost the race to wait on a Helper that already
    // ended, so the line is still the answer.
    function viaOpen(
      app: string,
      args: ReadonlyArray<string>,
    ): Effect.Effect<string, HelperExitedError, Scope.Scope> {
      return Effect.gen(function* () {
        const dir = yield* fs
          .makeTempDirectoryScoped()
          .pipe(Effect.mapError((cause) => new HelperExitedError({ cause })));
        const stdoutPath = join(dir, "stdout");
        const stderrPath = join(dir, "stderr");
        const code = yield* Command.make(
          "open",
          ...openArgs(app, stdoutPath, stderrPath, args),
        ).pipe(
          Command.exitCode,
          Effect.provideService(CommandExecutor.CommandExecutor, executor),
          Effect.mapError((cause) => new HelperExitedError({ cause })),
        );
        if (code !== 0) {
          const stdout = yield* fs
            .readFileString(stdoutPath)
            .pipe(Effect.orElseSucceed(() => ""));
          if (stdout.trim() !== "") {
            return stdout;
          }
          const stderr = yield* fs
            .readFileString(stderrPath)
            .pipe(Effect.orElseSucceed(() => ""));
          return yield* new HelperExitedError({
            cause: stderr.trim() || `open exited ${code}`,
          });
        }
        return yield* fs
          .readFileString(stdoutPath)
          .pipe(Effect.mapError((cause) => new HelperExitedError({ cause })));
      });
    }
  }),
  dependencies: [NodeContext.layer],
}) {
  // A test passes only the methods it changes; the rest answer as a Mac
  // with every permission granted and no iPhone or iPad.
  // biome-ignore lint/style/useNamingConvention: layers are PascalCase
  static Test = (
    methods: Partial<ConstructorParameters<typeof Helper>[0]> = {},
  ) =>
    Layer.succeed(
      this,
      new Helper({
        check: () => Effect.void,
        lines: () => Stream.empty,
        permissions: () =>
          Effect.succeed({
            accessibility: "granted",
            automation: {},
            fullDiskAccess: "granted",
          }),
        request: () => Effect.succeed("asked"),
        biomeDevices: () => Effect.succeed([]),
        biomeRecords: () => Effect.succeed([]),
        ...methods,
      }),
    );
}
