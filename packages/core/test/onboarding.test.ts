import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";

import { finishOnboarding, isOnboardingDone, Store } from "../src/index.js";

const useTest = <A, E>(effect: Effect.Effect<A, E, Store>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(Store.Test)));

describe("onboarding", () => {
  it("the flag is off on a fresh database", async () => {
    // Given: Store.Test
    // When
    const done = await useTest(isOnboardingDone());
    // Then
    expect(done).toBe(false);
  });

  it("finishOnboarding sets the flag once", async () => {
    // Given: Store.Test
    // When
    const { done, value } = await useTest(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* finishOnboarding();
        yield* finishOnboarding();
        const done = yield* isOnboardingDone();
        const value = yield* store.getSetting("onboarding");
        return { done, value };
      }),
    );
    // Then
    expect(done).toBe(true);
    expect(value).toEqual(Option.some("1"));
  });
});
