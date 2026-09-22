import { Command, CommandExecutor, FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Chunk, Data, Effect, Either, Layer, Stream } from "effect";

import {
  decodePermissions,
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

export class BiomeExitError extends Data.TaggedError("BiomeExitError")<{
  readonly code: number;
  readonly stderr: string;
  readonly lines?: ReadonlyArray<string>;
}> {
  override get message(): string {
    return `helper biome exited ${this.code}: ${this.stderr.trim()}`;
  }
}

export const biomeResult = (
  code: number,
  lines: ReadonlyArray<string>,
  stderr: string,
): Either.Either<ReadonlyArray<string>, BiomeExitError> =>
  code === 0
    ? Either.right(lines.filter((l) => l !== ""))
    : Either.left(
        new BiomeExitError({
          code,
          stderr,
          lines: lines.filter((l) => l !== ""),
        }),
      );

export const sinceArgs = (
  since: ReadonlyMap<string, number>,
): ReadonlyArray<string> =>
  [...since.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([device, seconds]) => [
      "--since",
      `${device}=${Math.floor(seconds)}`,
    ]);

export class Helper extends Effect.Service<Helper>()("Helper", {
  effect: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const executor = yield* CommandExecutor.CommandExecutor;
    const runBiome = (
      command: Command.Command,
    ): Effect.Effect<
      ReadonlyArray<string>,
      HelperExitedError | BiomeExitError
    > =>
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
          return yield* biomeResult(code, lines, stderr);
        }),
      ).pipe(
        Effect.mapError((cause) =>
          cause instanceof BiomeExitError
            ? cause
            : new HelperExitedError({ cause }),
        ),
      );
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
      lines: (path: string) =>
        Command.make(path, "watch").pipe(
          Command.stderr("inherit"),
          Command.streamLines,
          Stream.provideService(CommandExecutor.CommandExecutor, executor),
          Stream.mapError((cause) => new HelperExitedError({ cause })),
          Stream.concat(
            Stream.fail(
              new HelperExitedError({ cause: "helper stdout closed" }),
            ),
          ),
        ),
      permissions: (path: string) =>
        Command.make(path, "permissions").pipe(
          Command.string,
          Effect.provideService(CommandExecutor.CommandExecutor, executor),
          Effect.mapError((cause) => new HelperExitedError({ cause })),
          Effect.flatMap(decodePermissions),
        ),
      request: (path: string, grant: GrantRequest) =>
        Command.make(
          path,
          "permissions",
          "request",
          ...requestArgs(grant),
        ).pipe(
          Command.exitCode,
          Effect.provideService(CommandExecutor.CommandExecutor, executor),
          Effect.mapError((cause) => new HelperExitedError({ cause })),
          Effect.flatMap((code) =>
            code === 0
              ? Effect.succeed("asked" as const)
              : code === 3
                ? Effect.succeed("notRunning" as const)
                : Effect.fail(
                    new HelperExitedError({
                      cause: `permissions request exited ${code}`,
                    }),
                  ),
          ),
        ),
      biomeDevices: (path: string) =>
        runBiome(Command.make(path, "biome", "devices")),
      biomeRecords: (path: string, since: ReadonlyMap<string, number>) =>
        runBiome(Command.make(path, "biome", "records", ...sinceArgs(since))),
    };
  }),
  dependencies: [NodeContext.layer],
}) {
  // biome-ignore lint/style/useNamingConvention: layers are PascalCase
  static Test = Layer.succeed(
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
    }),
  );
}
