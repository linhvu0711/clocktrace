import { Store, type StoreError } from "@clocktrace/core";
import { type DateTime, Effect, Option, Schema } from "effect";

import { GrantRequest, GrantState, type Permissions } from "./helper.js";

const browserNames: Record<string, string> = {
  "com.apple.Safari": "Safari",
  "com.brave.Browser": "Brave",
  "com.google.Chrome": "Chrome",
  "com.microsoft.edgemac": "Edge",
  "com.operasoftware.Opera": "Opera",
  "com.vivaldi.Vivaldi": "Vivaldi",
  "org.chromium.Chromium": "Chromium",
};

export const knownBrowsers: ReadonlyArray<string> = Object.keys(browserNames);

export const browserName = (bundleId: string): string =>
  browserNames[bundleId] ?? bundleId;

export const noAnswerNote = (browser: string): string =>
  `${browser} did not answer · quit ${browser}, open it again, then run clocktrace permissions`;

export const PermissionItem = Schema.Struct({
  name: Schema.String,
  gives: Schema.String,
  loss: Schema.String,
  state: GrantState,
  request: GrantRequest,
  checkedAt: Schema.NullOr(Schema.DateTimeUtc),
});

export type PermissionItem = Schema.Schema.Type<typeof PermissionItem>;

export const permissionItems = (
  p: Permissions,
  saved: ReadonlyMap<
    string,
    { readonly state: "granted" | "denied"; readonly checkedAt: DateTime.Utc }
  > = new Map(),
): ReadonlyArray<PermissionItem> => {
  const automation = Object.entries(p.automation)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([bundleId, state]): ReadonlyArray<PermissionItem> => {
      const b = browserName(bundleId);
      const item = (
        s: GrantState,
        checkedAt: DateTime.Utc | null,
      ): PermissionItem => ({
        name: `automation ${b}`,
        gives: `URLs in ${b}`,
        loss: `URLs in ${b} are not tracked`,
        state: s,
        request: { kind: "automation", bundleId },
        checkedAt,
      });
      switch (state) {
        case "notInstalled":
        case "notAsked":
          return [];
        case "notRunning": {
          const grant = saved.get(bundleId);
          return grant === undefined
            ? []
            : [item(grant.state, grant.checkedAt)];
        }
        case "noAnswer": {
          const grant = saved.get(bundleId);
          return grant === undefined
            ? [item("noAnswer", null)]
            : [item(grant.state, grant.checkedAt)];
        }
        default:
          return [item(state, null)];
      }
    });
  return [
    {
      name: "accessibility",
      gives: "window titles",
      loss: "window titles are not tracked",
      state: p.accessibility,
      request: { kind: "accessibility" },
      checkedAt: null,
    },
    ...automation,
    {
      name: "full disk access",
      gives: "iPhone and iPad import",
      loss: "iPhone and iPad time is not imported",
      state: p.fullDiskAccess,
      request: { kind: "fullDiskAccess" },
      checkedAt: null,
    },
  ];
};

export const tccService = (
  r: GrantRequest,
): "Accessibility" | "AppleEvents" | "SystemPolicyAllFiles" => {
  switch (r.kind) {
    case "accessibility":
      return "Accessibility";
    case "automation":
      return "AppleEvents";
    case "fullDiskAccess":
      return "SystemPolicyAllFiles";
  }
};

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
