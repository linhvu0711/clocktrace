import type * as Terminal from "@effect/platform/Terminal";
import {
  Array as Arr,
  Context,
  Effect,
  Layer,
  Mailbox,
  Option,
  Ref,
} from "effect";

import { stripAnsi } from "./mock-console.js";

// =============================================================================
// Models
// =============================================================================

export interface MockTerminal extends Terminal.Terminal {
  readonly inputText: (text: string) => Effect.Effect<void>;
  readonly inputKey: (
    key: string,
    modifiers?: Partial<MockTerminal.Modifiers>,
  ) => Effect.Effect<void>;
}

export declare namespace MockTerminal {
  export interface Modifiers {
    readonly ctrl: boolean;
    readonly meta: boolean;
    readonly shift: boolean;
  }
}

// =============================================================================
// Context
// =============================================================================

const MockTerminalTag = Context.GenericTag<
  Terminal.Terminal,
  MockTerminal
>("@effect/platform/Terminal");

// =============================================================================
// Constructors
// =============================================================================

export const make = (interactive: boolean) =>
  Effect.gen(function* () {
    const queue = yield* Mailbox.make<Terminal.UserInput>();
    const chunks = yield* Ref.make<ReadonlyArray<string>>([]);

    const inputText: MockTerminal["inputText"] = (text: string) => {
      const inputs = Arr.map(text.split(""), (key) => toUserInput(key));
      return queue.offerAll(inputs).pipe(Effect.asVoid);
    };

    const inputKey: MockTerminal["inputKey"] = (
      key: string,
      modifiers?: Partial<MockTerminal.Modifiers>,
    ) => {
      const input = toUserInput(key, modifiers);
      return shouldQuit(input)
        ? queue.end
        : queue.offer(input).pipe(Effect.asVoid);
    };

    const display: MockTerminal["display"] = (input) =>
      Ref.update(chunks, (c) => [...c, input]);

    const shown = Ref.get(chunks).pipe(
      Effect.map((cs) => stripAnsi(cs.join(""))),
    );

    const layer = Layer.succeed(
      MockTerminalTag,
      MockTerminalTag.of({
        columns: Effect.succeed(80),
        rows: Effect.succeed(24),
        isTTY: Effect.succeed(interactive),
        display,
        readInput: Effect.succeed(queue),
        readLine: Effect.succeed(""),
        inputKey,
        inputText,
      }),
    );

    return { layer, inputKey, inputText, shown };
  });

// =============================================================================
// Utilities
// =============================================================================

const shouldQuit = (input: Terminal.UserInput): boolean =>
  input.key.ctrl && (input.key.name === "c" || input.key.name === "d");

const toUserInput = (
  key: string,
  modifiers: Partial<MockTerminal.Modifiers> = {},
): Terminal.UserInput => {
  const { ctrl = false, meta = false, shift = false } = modifiers;
  return {
    input: Option.some(key),
    key: { name: key, ctrl, meta, shift },
  };
};
