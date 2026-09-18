import { Schema } from "effect";

export const NewCategory = Schema.Struct({
  name: Schema.String,
  productive: Schema.Boolean,
});

export const Category = Schema.Struct({
  id: Schema.UUID,
  ...NewCategory.fields,
});

export type NewCategory = Schema.Schema.Type<typeof NewCategory>;
export type Category = Schema.Schema.Type<typeof Category>;
