import { Schema } from "effect";

export const BiomeRecordLine = Schema.Struct({
  device: Schema.String,
  ts: Schema.Number,
  focus: Schema.Literal("start", "end"),
  bundleId: Schema.String,
  reason: Schema.NullOr(Schema.String),
  appVersion: Schema.NullOr(Schema.String),
  build: Schema.NullOr(Schema.String),
  segment: Schema.String,
  offset: Schema.Number,
});

export const BiomeParseErrorLine = Schema.Struct({
  error: Schema.Literal("parse"),
  segment: Schema.String,
  offset: Schema.Number,
});

export const BiomeLine = Schema.parseJson(
  Schema.Union(BiomeRecordLine, BiomeParseErrorLine),
);

export type BiomeLine = Schema.Schema.Type<typeof BiomeLine>;

export const DevicePeerLine = Schema.parseJson(
  Schema.Struct({
    deviceIdentifier: Schema.String,
    me: Schema.Boolean,
    name: Schema.NullOr(Schema.String),
    model: Schema.NullOr(Schema.String),
    platform: Schema.NullOr(Schema.Number),
    lastSyncDate: Schema.NullOr(Schema.Number),
  }),
);

export type DevicePeerLine = Schema.Schema.Type<typeof DevicePeerLine>;

export const decodeBiomeLine = Schema.decodeUnknown(BiomeLine);

export const decodeDevicePeerLine = Schema.decodeUnknown(DevicePeerLine);
