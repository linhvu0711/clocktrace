import { Schema } from "effect";

export const RuleField = Schema.Literal(
  "app",
  "title",
  "url",
  "domain",
  "device",
);
export const RuleCompare = Schema.Literal(
  "is",
  "contains",
  "starts with",
  "ends with",
  "matches",
);
export const RuleEffect = Schema.Literal("category", "project", "private");

export const NewRule = Schema.Struct({
  position: Schema.Int,
  field: RuleField,
  compare: RuleCompare,
  value: Schema.String,
  effect: RuleEffect,
  target: Schema.NullOr(Schema.String),
});

export const Rule = Schema.Struct({ id: Schema.UUID, ...NewRule.fields });

export type NewRule = Schema.Schema.Type<typeof NewRule>;
export type Rule = Schema.Schema.Type<typeof Rule>;
