import { Store, type StoreError } from "@clocktrace/core";
import { type DateTime, Effect, Option, Schema } from "effect";

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

export const savedGrantKey = (bundleId: string): string => `grant.${bundleId}`;

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

export const deleteSavedGrant = (
  bundleId: string,
): Effect.Effect<void, StoreError, Store> =>
  Effect.gen(function* () {
    const store = yield* Store;
    yield* store.deleteSetting(savedGrantKey(bundleId));
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
      // macOS has no Grant for this browser any more (a reset, a new app
      // identity), so the Saved grant is no longer true.
      if (state === "notAsked") {
        yield* deleteSavedGrant(bundleId).pipe(
          Effect.catchTag("StoreError", () =>
            Effect.logWarning("saved grant not deleted").pipe(
              Effect.annotateLogs({ bundleId }),
            ),
          ),
        );
      }
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
