import * as CliPrompt from "@effect/cli/Prompt";
import { Terminal } from "@effect/platform";
import { Console, Data, Effect, Layer } from "effect";

// biome-ignore lint/complexity/noBannedTypes: the error has no fields
export class StoppedError extends Data.TaggedError("StoppedError")<{}> {
  override get message(): string {
    return "stopped, run clocktrace setup to continue";
  }
}

export class Stdin extends Effect.Service<Stdin>()("Stdin", {
  succeed: { isTTY: Effect.sync(() => Boolean(process.stdin.isTTY)) },
}) {
  // biome-ignore lint/style/useNamingConvention: layers are PascalCase
  static Test = Layer.succeed(this, new Stdin({ isTTY: Effect.succeed(true) }));
}

export class Prompt extends Effect.Service<Prompt>()("Prompt", {
  succeed: {
    interactive: Effect.flatMap(Terminal.Terminal, (t) =>
      Effect.flatMap(Stdin, (s) =>
        Effect.zipWith(t.isTTY, s.isTTY, (term, stdin) => term && stdin),
      ),
    ),
    ask: (question: string) =>
      CliPrompt.run(CliPrompt.text({ message: question })).pipe(
        Effect.mapError(() => new StoppedError()),
      ),
    confirm: (options: { message: string; initial: boolean }) =>
      CliPrompt.run(CliPrompt.confirm(options)).pipe(
        Effect.mapError(() => new StoppedError()),
      ),
    checklist: <A>(options: {
      message: string;
      choices: ReadonlyArray<{
        title: string;
        value: A;
        description?: string;
        selected?: boolean;
      }>;
    }) =>
      CliPrompt.run(CliPrompt.multiSelect(options)).pipe(
        Effect.mapError(() => new StoppedError()),
        // The last frame has no trailing newline; land errors on their own line.
        Effect.tapError(() => Console.log("")),
      ),
    print: (line: string) => Console.log(line),
    printError: (line: string) => Console.error(line),
    wait: <A, E, R>(label: string, effect: Effect.Effect<A, E, R>) =>
      Effect.flatMap(Terminal.Terminal, (t) =>
        Effect.flatMap(t.isTTY, (tty) =>
          tty
            ? Effect.ignore(t.display(label)).pipe(
                Effect.andThen(effect),
                Effect.ensuring(Effect.ignore(t.display("\r\u001b[2K"))),
              )
            : Console.log(label).pipe(Effect.andThen(effect)),
        ),
      ),
  },
}) {
  // biome-ignore lint/style/useNamingConvention: layers are PascalCase
  static Test = Layer.succeed(
    this,
    new Prompt({
      interactive: Effect.succeed(false),
      ask: () => Effect.succeed(""),
      confirm: () => Effect.succeed(false),
      checklist: () => Effect.succeed([]),
      print: () => Effect.void,
      printError: () => Effect.void,
      wait: (_label, effect) => effect,
    }),
  );
}
