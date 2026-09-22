import { DateTime, Effect, Option, Schema } from "effect";

import { AppStore } from "./app-store.js";
import type { StoreError } from "./errors.js";
import { iosAppNames } from "./ios-app-names.js";
import { Store } from "./store.js";

export const ResolvedApp = Schema.Struct({
  name: Schema.String,
  genre: Schema.NullOr(Schema.String),
});

export const AppName = Schema.Struct({
  bundleId: Schema.String,
  name: Schema.NullOr(Schema.String),
  genre: Schema.NullOr(Schema.String),
  fetchedAt: Schema.DateTimeUtc,
});

export const lookupRetryAfterMillis = 24 * 60 * 60 * 1000;

export const needsLookup = (
  bundleId: string,
): Effect.Effect<boolean, StoreError, Store> =>
  Effect.gen(function* () {
    if (iosAppNames[bundleId] !== undefined) {
      return false;
    }
    const store = yield* Store;
    const stored = yield* store.getAppName(bundleId);
    if (Option.isNone(stored)) {
      return true;
    }
    const row = stored.value;
    if (row.name !== null) {
      return false;
    }
    const now = yield* DateTime.now;
    return (
      now.epochMillis - row.fetchedAt.epochMillis >= lookupRetryAfterMillis
    );
  });

export const resolveAppName = (
  bundleId: string,
): Effect.Effect<Option.Option<ResolvedApp>, StoreError, Store | AppStore> =>
  Effect.gen(function* () {
    const name = iosAppNames[bundleId];
    if (name !== undefined) {
      return Option.some({ name, genre: null });
    }
    const store = yield* Store;
    const stored = yield* store.getAppName(bundleId);
    if (Option.isSome(stored)) {
      const row = stored.value;
      if (row.name !== null) {
        return Option.some({ name: row.name, genre: row.genre });
      }
      const now = yield* DateTime.now;
      if (
        now.epochMillis - row.fetchedAt.epochMillis <
        lookupRetryAfterMillis
      ) {
        return Option.none();
      }
    }
    const appStore = yield* AppStore;
    const found = yield* appStore
      .lookup(bundleId)
      .pipe(
        Effect.catchTag("AppStoreError", () =>
          Effect.succeed(Option.none<ResolvedApp>()),
        ),
      );
    if (Option.isNone(found)) {
      // A concurrent resolver may have stored a name while this lookup was
      // in flight; a failed attempt must not erase it.
      const recheck = yield* store.getAppName(bundleId);
      if (Option.isSome(recheck) && recheck.value.name !== null) {
        return Option.some({
          name: recheck.value.name,
          genre: recheck.value.genre,
        });
      }
    }
    const now = yield* DateTime.now;
    yield* store.upsertAppName({
      bundleId,
      name: Option.getOrNull(Option.map(found, (app) => app.name)),
      genre: Option.getOrNull(
        Option.flatMap(found, (app) => Option.fromNullable(app.genre)),
      ),
      fetchedAt: now,
    });
    return found;
  });

export type ResolvedApp = Schema.Schema.Type<typeof ResolvedApp>;
export type AppName = Schema.Schema.Type<typeof AppName>;
