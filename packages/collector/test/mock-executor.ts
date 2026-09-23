import { type Command, CommandExecutor } from "@effect/platform";
import { Effect, Layer, Ref, Sink, Stream } from "effect";
import { NodeInspectSymbol } from "effect/Inspectable";

export type ExecResult = { readonly code: number; readonly output?: string };

const argvOf = (command: Command.Command): ReadonlyArray<string> =>
  command._tag === "StandardCommand" ? [command.command, ...command.args] : [];

const fakeProcess = (
  code: number,
  output: string,
): CommandExecutor.Process => ({
  [CommandExecutor.ProcessTypeId]: CommandExecutor.ProcessTypeId,
  pid: 0 as CommandExecutor.ProcessId,
  exitCode: Effect.succeed(code as CommandExecutor.ExitCode),
  isRunning: Effect.succeed(false),
  kill: () => Effect.void,
  stdin: Sink.drain,
  stdout: Stream.make(new TextEncoder().encode(output)),
  stderr: Stream.empty,
  toJSON: () => ({}),
  toString: () => "",
  [NodeInspectSymbol]: () => ({}),
});

export const fakeExecutor = (
  results: Record<string, ExecResult>,
): Effect.Effect<{
  readonly layer: Layer.Layer<CommandExecutor.CommandExecutor>;
  readonly recorded: Ref.Ref<ReadonlyArray<string>>;
}> =>
  Effect.gen(function* () {
    const recorded = yield* Ref.make<ReadonlyArray<string>>([]);
    const lineOf = (command: Command.Command) => argvOf(command).join(" ");
    const resultOf = (command: Command.Command) =>
      results[lineOf(command)] ?? { code: 1 };
    const executor: CommandExecutor.CommandExecutor = {
      [CommandExecutor.TypeId]: CommandExecutor.TypeId,
      exitCode: (command) =>
        Ref.update(recorded, (r) => [...r, lineOf(command)]).pipe(
          Effect.andThen(
            Effect.succeed(resultOf(command).code as CommandExecutor.ExitCode),
          ),
        ),
      start: (command) =>
        Ref.update(recorded, (r) => [...r, lineOf(command)]).pipe(
          Effect.andThen(() => {
            const r = resultOf(command);
            return Effect.succeed(fakeProcess(r.code, r.output ?? ""));
          }),
        ),
      string: () => Effect.succeed(""),
      lines: () => Effect.succeed([]),
      stream: () => Stream.empty,
      streamLines: () => Stream.empty,
    };
    return {
      recorded,
      layer: Layer.succeed(CommandExecutor.CommandExecutor, executor),
    };
  });
