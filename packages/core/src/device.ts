import { Schema } from "effect";

export const DeviceKind = Schema.Literal("mac", "iphone", "ipad");

export const NewDevice = Schema.Struct({
  kind: DeviceKind,
  name: Schema.String,
  externalId: Schema.String,
});

export const Device = Schema.Struct({ id: Schema.UUID, ...NewDevice.fields });

export type NewDevice = Schema.Schema.Type<typeof NewDevice>;
export type Device = Schema.Schema.Type<typeof Device>;
