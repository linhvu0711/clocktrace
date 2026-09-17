import { Schema } from "effect";

export const NewProject = Schema.Struct({ name: Schema.String });

export const Project = Schema.Struct({
  id: Schema.UUID,
  ...NewProject.fields,
});

export type NewProject = Schema.Schema.Type<typeof NewProject>;
export type Project = Schema.Schema.Type<typeof Project>;
