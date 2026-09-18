import type { Device, StoreError } from "@clocktrace/core";
import { Store } from "@clocktrace/core";
import { Effect } from "effect";
import type { ParseError } from "effect/ParseResult";

import { MacIdentity, type MacIdentityError } from "./mac-identity.js";

export const registerDevice = (): Effect.Effect<
  Device,
  MacIdentityError | ParseError | StoreError,
  MacIdentity | Store
> =>
  Effect.gen(function* () {
    const mac = yield* MacIdentity;
    const store = yield* Store;
    const name = yield* mac.name;
    const hardwareUuid = yield* mac.hardwareUuid;
    return yield* store.getOrInsertDevice({
      kind: "mac",
      name,
      externalId: hardwareUuid,
    });
  });
