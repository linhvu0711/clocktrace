import { Effect, Option, Schema } from "effect";
import type { ParseError } from "effect/ParseResult";

import { ProjectNotFoundError, type StoreError } from "./errors.js";
import { NewProject, type Project } from "./project.js";
import { Store } from "./store.js";

export const ProjectInput = Schema.Struct({
  id: Schema.NullOr(Schema.String),
  ...NewProject.fields,
});

export const setProject = (
  input: ProjectInput,
): Effect.Effect<
  Project,
  ProjectNotFoundError | ParseError | StoreError,
  Store
> =>
  Effect.gen(function* () {
    const store = yield* Store;
    if (input.id === null) {
      return yield* store.insertProject({ name: input.name });
    }
    const updated = yield* store.updateProject(input.id, {
      name: input.name,
    });
    if (Option.isNone(updated)) {
      return yield* new ProjectNotFoundError({ id: input.id });
    }
    return updated.value;
  });

export type ProjectInput = Schema.Schema.Type<typeof ProjectInput>;
