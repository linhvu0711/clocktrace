import * as CliPrompt from "@effect/cli/Prompt";
import { Terminal } from "@effect/platform";
import { Console, Data, Effect, Layer } from "effect";

export class StoppedError extends Data.TaggedError("StoppedError")<{}> {
  override get message(): string {
    return "stopped, run clocktrace setup to continue";
  }
}

export class Prompt extends Effect.Service<Prompt>()("Prompt", {
  succeed: {
    interactive: Effect.flatMap(Terminal.Terminal, (t) => t.isTTY),
    ask: (question: string) =>
      CliPrompt.run(CliPrompt.text({ message: question })).pipe(
        Effect.mapError(() => new StoppedError()),
      ),
    print: (line: string) => Console.log(line),
  },
}) {
  // biome-ignore lint/style/useNamingConvention: layers are PascalCase
  static Test = Layer.succeed(
    this,
    new Prompt({
      interactive: Effect.succeed(false),
      ask: () => Effect.succeed(""),
      print: () => Effect.void,
    }),
  );
}
