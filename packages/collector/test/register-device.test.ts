import { Store } from "@clocktrace/core";
import { DateTime, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { MacIdentity } from "../src/mac-identity.js";
import { registerDevice } from "../src/register-device.js";

const layers = Layer.mergeAll(Store.Test, MacIdentity.Test);

const macNamed = (name: string) =>
  Layer.succeed(
    MacIdentity,
    new MacIdentity({
      name: Effect.succeed(name),
      hardwareUuid: Effect.succeed("01234567-89AB-CDEF-0123-456789ABCDEF"),
      macosVersion: Effect.succeed("27.0"),
    }),
  );

describe("register-device", () => {
  it("registerDevice creates this Mac once", async () => {
    // Given: a test store and the test Mac identity
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        // When
        const first = yield* registerDevice();
        const second = yield* registerDevice();
        const devices = yield* store.listDevices();
        return { first, second, devices };
      }).pipe(Effect.provide(layers)),
    );
    // Then
    expect({
      kind: result.first.kind,
      name: result.first.name,
      externalId: result.first.externalId,
    }).toEqual({
      kind: "mac",
      name: "Studio",
      externalId: "01234567-89AB-CDEF-0123-456789ABCDEF",
    });
    expect(result.second.id).toBe(result.first.id);
    expect(result.devices.length).toBe(1);
  });

  it("registerDevice takes the Mac's new name and keeps its id and Activities", async () => {
    // Given: the same Mac registered under a new name
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        // When
        const first = yield* registerDevice().pipe(
          Effect.provide(macNamed("Studio")),
        );
        yield* store.insertActivity({
          deviceId: first.id,
          bundleId: "com.apple.finder",
          appName: "Finder",
          title: null,
          url: null,
          startedAt: DateTime.unsafeMake("2026-09-18T17:00:00.000Z"),
          endedAt: DateTime.unsafeMake("2026-09-18T17:05:00.000Z"),
        });
        const second = yield* registerDevice().pipe(
          Effect.provide(macNamed("Studio 2")),
        );
        const devices = yield* store.listDevices();
        const activities = yield* store.readActivities({
          from: DateTime.unsafeMake("2026-09-18T00:00:00.000Z"),
          to: DateTime.unsafeMake("2026-09-19T00:00:00.000Z"),
        });
        return { first, second, devices, activities };
      }).pipe(Effect.provide(Store.Test)),
    );
    // Then
    expect(result.second.id).toBe(result.first.id);
    expect(result.second.name).toBe("Studio 2");
    expect(result.devices).toHaveLength(1);
    expect(result.devices[0]?.name).toBe("Studio 2");
    expect(result.activities).toHaveLength(1);
  });
});
