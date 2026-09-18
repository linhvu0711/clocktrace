import { Effect, Option } from "effect";

import type { StoreError } from "./errors.js";
import { Store } from "./store.js";

export const onboardingKey = "onboarding";

export const isOnboardingDone = (): Effect.Effect<boolean, StoreError, Store> =>
  Effect.map(
    Effect.flatMap(Store, (s) => s.getSetting(onboardingKey)),
    Option.isSome,
  );

export const finishOnboarding = (): Effect.Effect<void, StoreError, Store> =>
  Effect.flatMap(Store, (s) => s.setSetting(onboardingKey, "1"));
