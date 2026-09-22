import { Console, Context, Effect, Ref } from "effect";

export interface MockConsole extends Console.Console {
  readonly getLines: (
    params?: Partial<{
      readonly stripAnsi: boolean;
    }>,
  ) => Effect.Effect<ReadonlyArray<string>>;
  readonly getErrorLines: (
    params?: Partial<{
      readonly stripAnsi: boolean;
    }>,
  ) => Effect.Effect<ReadonlyArray<string>>;
}

export const MockConsole = Context.GenericTag<Console.Console, MockConsole>(
  "effect/Console",
);

const pattern = new RegExp(
  [
    "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)",
    "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PRZcf-ntqry=><~]))",
  ].join("|"),
  "g",
);

export const stripAnsi = (str: string) => str.replace(pattern, "");

export const make = Effect.gen(function* () {
  const lines = yield* Ref.make<ReadonlyArray<string>>([]);
  const errorLines = yield* Ref.make<ReadonlyArray<string>>([]);

  const getLines: MockConsole["getLines"] = (params = {}) =>
    Ref.get(lines).pipe(
      Effect.map((ls) => (params.stripAnsi || false ? ls.map(stripAnsi) : ls)),
    );

  const getErrorLines: MockConsole["getErrorLines"] = (params = {}) =>
    Ref.get(errorLines).pipe(
      Effect.map((ls) => (params.stripAnsi || false ? ls.map(stripAnsi) : ls)),
    );

  const log: MockConsole["log"] = (...args) =>
    Ref.update(lines, (ls) => [...ls, ...args.map(String)]);

  return MockConsole.of({
    [Console.TypeId]: Console.TypeId,
    getLines,
    getErrorLines,
    log,
    unsafe: globalThis.console,
    assert: () => Effect.void,
    clear: Effect.void,
    count: () => Effect.void,
    countReset: () => Effect.void,
    debug: () => Effect.void,
    dir: () => Effect.void,
    dirxml: () => Effect.void,
    // The CLI's error output (library validation messages) goes to
    // Console.error; capture it so tests can read what the user is shown.
    error: (...args) =>
      log(...args).pipe(
        Effect.andThen(
          Ref.update(errorLines, (ls) => [...ls, ...args.map(String)]),
        ),
      ),
    group: () => Effect.void,
    groupEnd: Effect.void,
    info: () => Effect.void,
    table: () => Effect.void,
    time: () => Effect.void,
    timeEnd: () => Effect.void,
    timeLog: () => Effect.void,
    trace: () => Effect.void,
    warn: () => Effect.void,
  });
});

export const getLines = (
  params?: Partial<{
    readonly stripAnsi?: boolean;
  }>,
): Effect.Effect<ReadonlyArray<string>> =>
  Effect.consoleWith((console) => (console as MockConsole).getLines(params));

export const getErrorLines = (
  params?: Partial<{
    readonly stripAnsi?: boolean;
  }>,
): Effect.Effect<ReadonlyArray<string>> =>
  Effect.consoleWith((console) =>
    (console as MockConsole).getErrorLines(params),
  );
