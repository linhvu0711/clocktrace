import { createInterface } from "node:readline";

import { Effect, Layer, Ref } from "effect";

export class Prompt extends Effect.Service<Prompt>()("Prompt", {
  sync: () => ({
    interactive: Effect.sync(() => Boolean(process.stdin.isTTY)),
    ask: (question: string) =>
      Effect.async<string>((resume) => {
        const rl = createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        rl.once("close", () => resume(Effect.succeed("")));
        rl.question(question, (answer) => {
          rl.close();
          resume(Effect.succeed(answer));
        });
      }),
    print: (line: string) =>
      Effect.sync(() => {
        console.log(line);
      }),
  }),
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

export const fakePrompt = (
  answers: ReadonlyArray<string>,
  interactive: boolean,
): Effect.Effect<{
  readonly layer: Layer.Layer<Prompt>;
  readonly output: Ref.Ref<ReadonlyArray<string>>;
  readonly questions: Ref.Ref<ReadonlyArray<string>>;
}> =>
  Effect.gen(function* () {
    const remaining = yield* Ref.make<ReadonlyArray<string>>(answers);
    const output = yield* Ref.make<ReadonlyArray<string>>([]);
    const questions = yield* Ref.make<ReadonlyArray<string>>([]);
    const layer = Layer.succeed(
      Prompt,
      new Prompt({
        interactive: Effect.succeed(interactive),
        ask: (question) =>
          Ref.update(questions, (qs) => [...qs, question]).pipe(
            Effect.andThen(
              Ref.modify(remaining, (as) => [as[0] ?? "", as.slice(1)]),
            ),
          ),
        print: (line) => Ref.update(output, (o) => [...o, line]),
      }),
    );
    return { layer, output, questions };
  });
