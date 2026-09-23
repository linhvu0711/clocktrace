import { Store, StoreError } from "@clocktrace/core";
import { DateTime, Effect, Layer, Logger, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  permissionItems,
  readSavedGrants,
  saveLiveGrants,
  tccService,
} from "../src/grant.js";
import { Permissions } from "../src/helper.js";

const line =
  '{"accessibility":"granted","automation":{"com.apple.Safari":"notRunning","com.brave.Browser":"granted","com.google.Chrome":"notAsked","com.microsoft.edgemac":"notInstalled","com.operasoftware.Opera":"notInstalled","com.vivaldi.Vivaldi":"notInstalled","org.chromium.Chromium":"notInstalled"},"fullDiskAccess":"denied"}';

describe("grant", () => {
  it("items list installed browsers by bundle id with display names", () => {
    // Given: the same decoded value
    const p = Schema.decodeUnknownSync(Permissions)(line);
    // When
    const items = permissionItems(p).map((i) => [i.name, i.state]);
    // Then
    expect(items).toEqual([
      ["accessibility", "granted"],
      ["automation Brave", "granted"],
      ["full disk access", "denied"],
    ]);
  });

  it("an unknown bundle id keeps its id", () => {
    // Given: one browser not in the name map
    const p = {
      accessibility: "granted" as const,
      automation: { "org.example.Browser": "granted" as const },
      fullDiskAccess: "granted" as const,
    };
    // When
    const item = permissionItems(p)[1];
    // Then
    expect(item).toEqual({
      name: "automation org.example.Browser",
      gives: "URLs in org.example.Browser",
      loss: "URLs in org.example.Browser are not tracked",
      state: "granted",
      request: { kind: "automation", bundleId: "org.example.Browser" },
      checkedAt: null,
    });
  });

  it("tccService names tccutil's services", () => {
    // Given: the three request kinds, automation with com.apple.Safari
    // When
    const services = [
      tccService({ kind: "accessibility" }),
      tccService({ kind: "automation", bundleId: "com.apple.Safari" }),
      tccService({ kind: "fullDiskAccess" }),
    ];
    // Then
    expect(services).toEqual([
      "Accessibility",
      "AppleEvents",
      "SystemPolicyAllFiles",
    ]);
  });

  it("a closed browser shows its Saved grant", async () => {
    // Given: Safari closed, Chrome answered; a saved denied Grant for Safari
    const p = Schema.decodeUnknownSync(Permissions)(line);
    const checkedAt = DateTime.unsafeMake("2026-01-01T18:00:00Z");
    const saved = new Map([
      ["com.apple.Safari", { state: "denied" as const, checkedAt }],
    ]);
    // When
    const items = permissionItems(p, saved).map((i) => [
      i.name,
      i.state,
      i.checkedAt,
    ]);
    // Then
    expect(items).toEqual([
      ["accessibility", "granted", null],
      ["automation Safari", "denied", checkedAt],
      ["automation Brave", "granted", null],
      ["full disk access", "denied", null],
    ]);
  });

  it("a never-asked browser and a closed browser with no Saved grant are left out", () => {
    // Given: Safari closed, Chrome never asked, no saved grants
    const p = Schema.decodeUnknownSync(Permissions)(line);
    // When
    const items = permissionItems(p).map((i) => i.name);
    // Then
    expect(items).toEqual([
      "accessibility",
      "automation Brave",
      "full disk access",
    ]);
  });

  it("readSavedGrants returns a saved grant", async () => {
    // Given: a Saved grant for Safari in the settings table
    const grants = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* store.setSetting(
          "grant.com.apple.Safari",
          '{"state":"granted","checkedAt":"2026-09-23T20:20:00.000Z"}',
        );
        // When
        return yield* readSavedGrants();
      }).pipe(Effect.provide(Store.Test)),
    );
    // Then
    const safari = grants.get("com.apple.Safari");
    expect(grants.size).toBe(1);
    expect(safari?.state).toBe("granted");
    expect(safari && DateTime.formatIso(safari.checkedAt)).toBe(
      "2026-09-23T20:20:00.000Z",
    );
  });

  it("a saved grant that does not decode counts as none", async () => {
    // Given: a Saved grant value that is not JSON
    const grants = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* store.setSetting("grant.com.apple.Safari", "not json");
        // When
        return yield* readSavedGrants();
      }).pipe(Effect.provide(Store.Test)),
    );
    // Then
    expect(grants.size).toBe(0);
  });

  it("a failed Saved grant delete logs and the walk goes on", async () => {
    // Given: a Store whose deleteSetting fails; Chrome reads notAsked and
    // Safari reads granted
    const failingDelete = Layer.effect(
      Store,
      Effect.map(
        Store,
        (s) =>
          new Store({
            ...s,
            deleteSetting: () =>
              Effect.fail(new StoreError({ cause: "disk full" })),
          }),
      ),
    );
    const logs: Array<string> = [];
    const testLogger = Logger.replace(
      Logger.defaultLogger,
      Logger.make(({ message }) => {
        logs.push(String(message));
      }),
    );
    // When
    const safari = await Effect.runPromise(
      Effect.gen(function* () {
        yield* saveLiveGrants(
          {
            accessibility: "granted",
            automation: {
              "com.google.Chrome": "notAsked",
              "com.apple.Safari": "granted",
            },
            fullDiskAccess: "granted",
          },
          DateTime.unsafeMake("2026-09-23T20:20:00Z"),
        );
        const store = yield* Store;
        return yield* store.getSetting("grant.com.apple.Safari");
      }).pipe(
        Effect.provide(
          Layer.merge(Layer.provide(failingDelete, Store.Test), testLogger),
        ),
      ),
    );
    // Then
    expect(logs).toEqual(["saved grant not deleted"]);
    expect(Option.isSome(safari)).toBe(true);
  });
});
