import { Effect } from "effect";
import type { ParseError } from "effect/ParseResult";

import type { Device, NewDevice } from "./device.js";
import type { StoreError } from "./errors.js";
import { openStore } from "./sqlite-store.js";

export interface StoreShape {
  readonly getOrInsertDevice: (
    input: NewDevice,
  ) => Effect.Effect<Device, ParseError | StoreError>;
  readonly listDevices: () => Effect.Effect<ReadonlyArray<Device>, StoreError>;
}

export class Store extends Effect.Service<Store>()("Store", {
  scoped: (path: string) => openStore(path),
}) {
  // biome-ignore lint/style/useNamingConvention: layers are PascalCase
  static Test = this.Default(":memory:");
}
