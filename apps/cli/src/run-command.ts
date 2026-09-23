import { Command, CommandExecutor } from "@effect/platform";
import { Chunk, Effect, Stream } from "effect";

const collect = (
  stream: Stream.Stream<Uint8Array, unknown>,
): Effect.Effect<string> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runCollect,
    Effect.map((chunk) => Chunk.toReadonlyArray(chunk).join("")),
    Effect.catchAll(() => Effect.succeed("")),
  );

// Runs a command to its end and never fails: a command that cannot start
// reads as exit 1 with no output. The output is stdout and stderr joined.
export const runCommand = (
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
