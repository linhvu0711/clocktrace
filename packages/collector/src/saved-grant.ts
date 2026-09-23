import { Store, type StoreError } from "@clocktrace/core";
import { DateTime, Effect, Option, Schema } from "effect";

import { knownBrowsers, type Permissions } from "./permissions.js";

export const SavedGrant = Schema.parseJson(
  Schema.Struct({
    state: Schema.Literal("granted", "denied"),
    checkedAt: Schema.DateTimeUtc,
  }),
);

export type SavedGrant = Schema.Schema.Type<typeof SavedGrant>;

const encodeSavedGrant = Schema.encodeSync(SavedGrant);
const decodeSavedGrant = Schema.decodeUnknown(SavedGrant);

export const savedGrantKey = (bundleId: string): string =>
  `grant.${bundleId}`;

export const saveGrant = (
  bundleId: string,
  state: "granted" | "denied",
  at: DateTime.Utc,
): Effect.Effect<void, StoreError, Store> =>
  Effect.gen(function* () {
    const store = yield* Store;
    yield* store.setSetting(
      savedGrantKey(bundleId),
      encodeSavedGrant({ state, checkedAt: at }),
    );
  });

export const readSavedGrants = (): Effect.Effect<
  ReadonlyMap<string, SavedGrant>,
  StoreError,
  Store
> =>
  Effect.gen(function* () {
    const store = yield* Store;
    const grants = new Map<string, SavedGrant>();
    for (const bundleId of knownBrowsers) {
      const raw = yield* store.getSetting(savedGrantKey(bundleId));
      const decoded = yield* Effect.option(
        decodeSavedGrant(Option.getOrElse(raw, () => "")),
      );
      if (Option.isSome(decoded)) {
        grants.set(bundleId, decoded.value);
      }
    }
    return grants;
  });

export const saveLiveGrants = (
  p: Permissions,
  at: DateTime.Utc,
): Effect.Effect<void, never, Store> =>
  Effect.gen(function* () {
    for (const [bundleId, state] of Object.entries(p.automation)) {
      if (state === "granted" || state === "denied") {
        yield* saveGrant(bundleId, state, at).pipe(
          Effect.catchTag("StoreError", () =>
            Effect.logWarning("saved grant not written").pipe(
              Effect.annotateLogs({ bundleId }),
            ),
          ),
        );
      }
    }
  });
