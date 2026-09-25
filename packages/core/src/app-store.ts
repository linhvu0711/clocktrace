import { Effect, Layer, Option, Schema } from "effect";

import type { ResolvedApp } from "./app-names.js";
import { AppStoreError } from "./errors.js";

const LookupResponse = Schema.Struct({
  resultCount: Schema.Int,
  results: Schema.Array(
    Schema.Struct({
      trackName: Schema.String,
      primaryGenreName: Schema.NullOr(Schema.String),
    }),
  ),
});

export class AppStore extends Effect.Service<AppStore>()("AppStore", {
  sync: () => ({
    lookup: (
      bundleId: string,
      country: string,
    ): Effect.Effect<Option.Option<ResolvedApp>, AppStoreError> =>
      Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: (signal) =>
            fetch(
              `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(bundleId)}&country=${country}`,
              {
                signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
              },
            ),
          catch: (cause) => new AppStoreError({ cause }),
        });
        if (!response.ok) {
          return yield* new AppStoreError({
            cause: `lookup ${response.status}`,
          });
        }
        const body = yield* Effect.tryPromise({
          try: () => response.json(),
          catch: (cause) => new AppStoreError({ cause }),
        }).pipe(
          Effect.flatMap((json) =>
            Schema.decodeUnknown(LookupResponse)(json).pipe(
              Effect.mapError((cause) => new AppStoreError({ cause })),
            ),
          ),
        );
        const hit = body.results[0];
        return body.resultCount > 0 && hit !== undefined
          ? Option.some({ name: hit.trackName, genre: hit.primaryGenreName })
          : Option.none();
      }),
  }),
}) {
  // biome-ignore lint/style/useNamingConvention: layers are PascalCase
  static Test = Layer.succeed(
    this,
    new AppStore({
      lookup: () => Effect.succeed(Option.none()),
    }),
  );
}
