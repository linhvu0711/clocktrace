import { Effect } from "effect";

export const ready: Effect.Effect<string> = Effect.succeed("cli ready");
