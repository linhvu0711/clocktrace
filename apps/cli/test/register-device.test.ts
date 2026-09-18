import { Store } from "@clocktrace/core";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { MacIdentity } from "../src/mac-identity.js";
import { registerDevice } from "../src/register-device.js";

const layers = Layer.mergeAll(Store.Test, MacIdentity.Test);

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
});
