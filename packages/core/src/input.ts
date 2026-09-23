import { Effect, ParseResult, Schema } from "effect";

import { InvalidInputError } from "./errors.js";

// Core checks every tool input itself, so the CLI Twin and the Host get the
// same words: the first failing field and the rule it breaks.
export const decodeInput =
  <A, I>(schema: Schema.Schema<A, I>) =>
  (input: I): Effect.Effect<A, InvalidInputError> =>
    Schema.decodeUnknown(schema)(input).pipe(
      Effect.mapError((error) => {
        const [issue] = ParseResult.ArrayFormatter.formatErrorSync(error);
        return new InvalidInputError({
          field: issue?.path.join(".") ?? "input",
          reason: issue?.message ?? error.message,
        });
      }),
    );
