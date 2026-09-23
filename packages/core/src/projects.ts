import { Effect, Option, Schema } from "effect";
import type { ParseError } from "effect/ParseResult";

import {
  type InvalidInputError,
  ProjectInUseError,
  ProjectNotFoundError,
  type StoreError,
} from "./errors.js";
import { decodeInput } from "./input.js";
import { NewProject, type Project } from "./project.js";
import { Store } from "./store.js";

export const ProjectInput = Schema.Struct({
  id: Schema.optionalWith(Schema.NullOr(Schema.String), {
    default: () => null,
  }),
  ...NewProject.fields,
});

export const setProject = (
  encoded: Schema.Schema.Encoded<typeof ProjectInput>,
): Effect.Effect<
  Project,
  InvalidInputError | ProjectNotFoundError | ParseError | StoreError,
  Store
> =>
  Effect.gen(function* () {
    const input = yield* decodeInput(ProjectInput)(encoded);
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

export const removeProject = (
  id: string,
): Effect.Effect<
  void,
  ProjectNotFoundError | ProjectInUseError | StoreError,
  Store
> =>
  Effect.gen(function* () {
    const store = yield* Store;
    const rules = yield* store.listRules();
    const count = rules.filter(
      (rule) => rule.effect === "project" && rule.target === id,
    ).length;
    if (count > 0) {
      return yield* new ProjectInUseError({ id, count });
    }
    const deleted = yield* store.deleteProject(id);
    if (!deleted) {
      return yield* new ProjectNotFoundError({ id });
    }
  });

export type ProjectInput = Schema.Schema.Type<typeof ProjectInput>;
