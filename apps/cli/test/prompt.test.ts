import type { CommandExecutor, FileSystem, Path, Terminal } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Console, Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { Prompt, Stdin, StoppedError } from "../src/prompt.js";
import * as MockConsole from "./mock-console.js";
import * as MockTerminal from "./mock-terminal.js";

type Key = { readonly key: string; readonly ctrl?: boolean } | string;

type Provided =
  | Prompt
  | Stdin
  | typeof Console
  | Terminal.Terminal
  | FileSystem.FileSystem
  | Path.Path
  | CommandExecutor.CommandExecutor;

const run = <A, E>(
  keys: ReadonlyArray<Key>,
  tty: boolean,
  effect: Effect.Effect<A, E, Provided>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const terminal = yield* MockTerminal.make(tty);
      const console = yield* MockConsole.make;
      for (const k of keys) {
        yield* typeof k === "string"
          ? terminal.inputText(k)
          : terminal.inputKey(
              k.key,
              k.ctrl === undefined ? {} : { ctrl: k.ctrl },
            );
      }
      const layers = Layer.mergeAll(
        Console.setConsole(console),
        NodeContext.layer,
        terminal.layer,
        Prompt.Default,
        Stdin.Test,
      );
      const exit = yield* Effect.exit(
        effect.pipe(Effect.provide(layers)) as Effect.Effect<A, E>,
      );
      return {
        exit,
        output: yield* console.getLines({ stripAnsi: true }),
        shown: yield* terminal.shown,
      };
    }),
  );

describe("Prompt", () => {
  it("confirm returns the default on Enter", async () => {
    // Given: an Enter keypress at a (Y/n) confirm
    // When
    const { exit, shown } = await run([{ key: "enter" }], true, Effect.flatMap(
      Prompt,
      (prompt) => prompt.confirm({ message: "Allow?", initial: true }),
    ));
    // Then
    expect(exit).toEqual(Exit.succeed(true));
    expect(shown).toContain("Allow?");
    expect(shown).toContain("(Y/n)");
  });

  it("confirm returns false on n", async () => {
    // Given: n then Enter at a (Y/n) confirm
    // When
    const { exit } = await run(["n", { key: "enter" }], true, Effect.flatMap(
      Prompt,
      (prompt) => prompt.confirm({ message: "Allow?", initial: true }),
    ));
    // Then
    expect(exit).toEqual(Exit.succeed(false));
  });

  it("ctrl-c at confirm fails StoppedError", async () => {
    // Given: ctrl-c at a confirm
    // When
    const { exit } = await run([{ key: "c", ctrl: true }], true, Effect.flatMap(
      Prompt,
      (prompt) => prompt.confirm({ message: "Allow?", initial: false }),
    ));
    // Then
    expect(exit).toEqual(Exit.fail(new StoppedError()));
  });

  it("wait shows the line on a terminal and clears it", async () => {
    // Given: a TTY terminal
    // When
    const { exit, output, shown } = await run([], true, Effect.flatMap(
      Prompt,
      (prompt) => prompt.wait("  starting collector…", Effect.succeed(7)),
    ));
    // Then
    expect(exit).toEqual(Exit.succeed(7));
    expect(shown).toContain("  starting collector…");
    expect(output).toEqual([]);
  });

  it("wait prints the line when there is no terminal", async () => {
    // Given: no TTY
    // When
    const { exit, output, shown } = await run([], false, Effect.flatMap(
      Prompt,
      (prompt) => prompt.wait("  starting collector…", Effect.succeed(7)),
    ));
    // Then
    expect(exit).toEqual(Exit.succeed(7));
    expect(output).toEqual(["  starting collector…"]);
    expect(shown).toBe("");
  });
});
