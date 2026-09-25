import { Schema } from "effect";

export const HelperLine = Schema.parseJson(
  Schema.Struct({
    ts: Schema.DateTimeUtc,
    app: Schema.NullOr(Schema.String),
    bundleId: Schema.NullOr(Schema.String),
    grant: Schema.optionalWith(
      Schema.NullOr(
        Schema.Literal("granted", "denied", "notAsked", "noAnswer"),
      ),
      { default: () => null },
    ),
    title: Schema.NullOr(Schema.String),
    url: Schema.NullOr(Schema.String),
    // An older Helper sends no screenHold: that is no Screen hold.
    screenHold: Schema.optionalWith(Schema.Boolean, { default: () => false }),
    idleSeconds: Schema.Number,
    missing: Schema.Array(Schema.String),
  }),
);

export type HelperLine = Schema.Schema.Type<typeof HelperLine>;

export const decodeHelperLine = Schema.decodeUnknown(HelperLine);
