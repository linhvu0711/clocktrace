import { Effect } from "effect";

export { version } from "./version.js";

export const ready: Effect.Effect<string> = Effect.succeed("cli ready");
