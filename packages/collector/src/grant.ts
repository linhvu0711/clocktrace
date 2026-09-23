import { Store, type StoreError } from "@clocktrace/core";
import { DateTime, Effect, Option, Schema } from "effect";
import type { ParseError } from "effect/ParseResult";

import { App, appPath } from "./app.js";
import {
  type GrantRequest,
  GrantState,
  Helper,
  type HelperExitedError,
  type Permissions,
} from "./helper.js";

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

export const GrantKind = Schema.Literal(
  "accessibility",
  "automation",
  "fullDiskAccess",
);

export type GrantKind = Schema.Schema.Type<typeof GrantKind>;

// The Helper's states, plus notChecked (the App is missing, so nothing was
// asked) and noBrowser (the item that stands for "no browser used yet").
export const GrantItemState = Schema.Literal(
  ...GrantState.literals,
  "notChecked",
  "noBrowser",
);

export type GrantItemState = Schema.Schema.Type<typeof GrantItemState>;

export const GrantItem = Schema.Struct({
  kind: GrantKind,
  bundleId: Schema.NullOr(Schema.String),
  name: Schema.String,
  label: Schema.String,
  gives: Schema.String,
  loss: Schema.String,
  fix: Schema.String,
  state: GrantItemState,
  checkedAt: Schema.NullOr(Schema.DateTimeUtc),
});

export type GrantItem = Schema.Schema.Type<typeof GrantItem>;

export const GrantPicture = Schema.Struct({
  app: Schema.Literal("present", "missing"),
  items: Schema.Array(GrantItem),
});

export type GrantPicture = Schema.Schema.Type<typeof GrantPicture>;

const fixIn = (pane: string): string =>
  `denied · turn it on in System Settings › Privacy › ${pane}`;

// The words of one Grant. A null bundleId under automation is the
// "no browser used yet" item.
export const grantWords = (
  kind: GrantKind,
  bundleId: string | null,
): Pick<GrantItem, "name" | "label" | "gives" | "loss" | "fix"> => {
  switch (kind) {
    case "accessibility":
      return {
        name: "accessibility",
        label: "Accessibility",
        gives: "window titles",
        loss: "window titles are not tracked",
        fix: fixIn("Accessibility"),
      };
    case "fullDiskAccess":
      return {
        name: "full disk access",
        label: "Full Disk Access",
        gives: "iPhone and iPad import",
        loss: "iPhone and iPad time is not imported",
        fix: fixIn("Full Disk Access"),
      };
    case "automation": {
      if (bundleId === null) {
        return {
          name: "automation",
          label: "Automation",
          gives: "browser URLs",
          loss: "browser URLs are not tracked",
          fix: fixIn("Automation"),
        };
      }
      const b = browserName(bundleId);
      return {
        name: `automation ${b}`,
        label: `Automation · ${b}`,
        gives: `URLs in ${b}`,
        loss: `URLs in ${b} are not tracked`,
        fix: fixIn("Automation"),
      };
    }
  }
};

const grantItem = (
  kind: GrantKind,
  bundleId: string | null,
  state: GrantItemState,
  checkedAt: DateTime.Utc | null,
): GrantItem => ({
  kind,
  bundleId,
  ...grantWords(kind, bundleId),
  state,
  checkedAt,
});

const pictureItems = (
  p: Permissions,
  saved: ReadonlyMap<string, SavedGrant>,
): ReadonlyArray<GrantItem> => {
  const automation = Object.entries(p.automation)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([bundleId, state]): ReadonlyArray<GrantItem> => {
      const item = (s: GrantItemState, checkedAt: DateTime.Utc | null) =>
        grantItem("automation", bundleId, s, checkedAt);
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
    grantItem("accessibility", null, p.accessibility, null),
    ...(automation.length === 0
      ? [grantItem("automation", null, "noBrowser", null)]
      : automation),
    grantItem("fullDiskAccess", null, p.fullDiskAccess, null),
  ];
};

// The request that asks macOS for this Grant. The "no browser used yet"
// item has none.
export const grantRequest = (item: GrantItem): Option.Option<GrantRequest> => {
  switch (item.kind) {
    case "automation":
      return item.bundleId === null
        ? Option.none()
        : Option.some({ kind: "automation", bundleId: item.bundleId });
    case "accessibility":
    case "fullDiskAccess":
      return Option.some({ kind: item.kind });
  }
};

// "N of M granted" for status and permissions. The "no browser used yet"
// item counts as not granted.
export const grantCount = (
  items: ReadonlyArray<{ readonly state: string }>,
): string =>
  `${items.filter((i) => i.state === "granted").length} of ${items.length} granted`;

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

// The Grant picture: a live check through the App, the Saved grants it
// writes or removes, and one item per permission. A missing App runs no
// Helper and every item is notChecked.
export const grantPicture = (): Effect.Effect<
  GrantPicture,
  HelperExitedError | ParseError | StoreError,
  App | Helper | Store
> =>
  Effect.gen(function* () {
    const app = yield* App;
    if (!(yield* app.isInstalled())) {
      return {
        app: "missing",
        items: [
          grantItem("accessibility", null, "notChecked", null),
          grantItem("fullDiskAccess", null, "notChecked", null),
        ],
      };
    }
    const helper = yield* Helper;
    const grants = yield* Effect.scoped(helper.permissions(appPath));
    yield* saveLiveGrants(grants, yield* DateTime.now);
    const saved = yield* readSavedGrants();
    return { app: "present", items: pictureItems(grants, saved) };
  });
