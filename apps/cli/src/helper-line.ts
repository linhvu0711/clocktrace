import { Schema } from "effect";

export const HelperLine = Schema.parseJson(
  Schema.Struct({
    ts: Schema.DateTimeUtc,
    app: Schema.NullOr(Schema.String),
    bundleId: Schema.NullOr(Schema.String),
    title: Schema.NullOr(Schema.String),
    url: Schema.NullOr(Schema.String),
    idleSeconds: Schema.Number,
    missing: Schema.Array(Schema.String),
  }),
);

export type HelperLine = Schema.Schema.Type<typeof HelperLine>;

export const decodeHelperLine = Schema.decodeUnknown(HelperLine);
