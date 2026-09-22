import { Effect, Option, Schema } from "effect";

import { iosAppNames } from "./ios-app-names.js";

export const ResolvedApp = Schema.Struct({
  name: Schema.String,
  genre: Schema.NullOr(Schema.String),
});

export const resolveAppName = (
  bundleId: string,
): Effect.Effect<Option.Option<ResolvedApp>> => {
  const name = iosAppNames[bundleId];
  return Effect.succeed(
    name === undefined ? Option.none() : Option.some({ name, genre: null }),
  );
};

export type ResolvedApp = Schema.Schema.Type<typeof ResolvedApp>;
