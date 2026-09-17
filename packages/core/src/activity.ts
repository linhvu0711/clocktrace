import { type DateTime, Schema } from "effect";

const fields = {
  deviceId: Schema.UUID,
  bundleId: Schema.String,
  appName: Schema.String,
  title: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
  startedAt: Schema.DateTimeUtc,
  endedAt: Schema.DateTimeUtc,
};

const NewActivityStruct = Schema.Struct(fields);
const ActivityStruct = Schema.Struct({ id: Schema.UUID, ...fields });

const endsAfterStart = (a: {
  readonly startedAt: DateTime.Utc;
  readonly endedAt: DateTime.Utc;
}) =>
  a.endedAt.epochMillis >= a.startedAt.epochMillis
    ? undefined
    : { path: ["endedAt"], message: "endedAt is before startedAt" };

export const NewActivity = NewActivityStruct.pipe(
  Schema.filter<typeof NewActivityStruct>(endsAfterStart),
);

export const Activity = ActivityStruct.pipe(
  Schema.filter<typeof ActivityStruct>(endsAfterStart),
);

export type NewActivity = Schema.Schema.Type<typeof NewActivity>;
export type Activity = Schema.Schema.Type<typeof Activity>;
