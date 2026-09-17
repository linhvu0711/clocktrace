import { type DateTime, Effect } from "effect";
import type { ParseError } from "effect/ParseResult";

import type { Activity, NewActivity } from "./activity.js";
import type { Device, NewDevice } from "./device.js";
import type { StoreError } from "./errors.js";
import { openStore } from "./sqlite-store.js";

export interface StoreShape {
  readonly getOrInsertDevice: (
    input: NewDevice,
  ) => Effect.Effect<Device, ParseError | StoreError>;
  readonly listDevices: () => Effect.Effect<ReadonlyArray<Device>, StoreError>;
  readonly insertActivity: (
    input: NewActivity,
  ) => Effect.Effect<Activity, ParseError | StoreError>;
  readonly readActivities: (query: {
    readonly deviceId?: string | undefined;
    readonly from: DateTime.Utc;
    readonly to: DateTime.Utc;
  }) => Effect.Effect<ReadonlyArray<Activity>, StoreError>;
}

export class Store extends Effect.Service<Store>()("Store", {
  scoped: (path: string) => openStore(path),
}) {
  // biome-ignore lint/style/useNamingConvention: layers are PascalCase
  static Test = this.Default(":memory:");
}
