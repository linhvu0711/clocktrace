import { Command, CommandExecutor, FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Data, Effect, Layer, Stream } from "effect";

export class HelperNotFoundError extends Data.TaggedError(
  "HelperNotFoundError",
)<{
  readonly path: string;
}> {
  override get message(): string {
    return `helper not found at ${this.path}`;
  }
}

export class HelperExitedError extends Data.TaggedError("HelperExitedError")<{
  readonly cause: unknown;
}> {}

export class Helper extends Effect.Service<Helper>()("Helper", {
  effect: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const executor = yield* CommandExecutor.CommandExecutor;
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
    };
  }),
  dependencies: [NodeContext.layer],
}) {
  // biome-ignore lint/style/useNamingConvention: layers are PascalCase
  static Test = Layer.succeed(
    this,
    new Helper({ check: () => Effect.void, lines: () => Stream.empty }),
  );
}
