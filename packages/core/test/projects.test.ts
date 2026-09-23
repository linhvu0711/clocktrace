import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";

import type { ProjectInUseError, ProjectNotFoundError } from "../src/index.js";
import { openStore, removeProject, Store, setProject } from "../src/index.js";

const EmptyStore = Layer.scoped(
  Store,
  Effect.map(openStore(":memory:"), (shape) => new Store(shape)),
);

const useEmpty = <A, E>(effect: Effect.Effect<A, E, Store>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(EmptyStore)));

describe("projects", () => {
  it("removeProject deletes the Project", async () => {
    // Given: an empty store with one project
    const projects = await useEmpty(
      Effect.gen(function* () {
        const store = yield* Store;
        const inserted = yield* store.insertProject({ name: "Thesis" });
        // When
        yield* removeProject(inserted.id);
        return yield* store.listProjects();
      }),
    );
    // Then
    expect(projects).toEqual([]);
  });

  it("removeProject of an unknown id names the id", async () => {
    // Given: an empty store
    // When
    const result = await useEmpty(
      Effect.either(removeProject("00000000-0000-4000-8000-000000000077")),
    );
    // Then
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      const error = result.left as ProjectNotFoundError;
      expect(error._tag).toBe("ProjectNotFoundError");
      expect(error.message).toBe(
        "project 00000000-0000-4000-8000-000000000077 not found",
      );
    }
  });

  it("removeProject refuses while 3 Rules use it", async () => {
    // Given: an empty store with a Project three Rules point at
    const { id, result, projects } = await useEmpty(
      Effect.gen(function* () {
        const store = yield* Store;
        const proj = yield* store.insertProject({ name: "Thesis" });
        for (const [position, value] of ["a", "b", "c"].entries()) {
          yield* store.insertRule({
            position,
            field: "app",
            compare: "is",
            value,
            effect: "project",
            target: proj.id,
          });
        }
        // When
        const result = yield* Effect.either(removeProject(proj.id));
        const projects = yield* store.listProjects();
        return { id: proj.id, result, projects };
      }),
    );
    // Then
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      const error = result.left as ProjectInUseError;
      expect(error._tag).toBe("ProjectInUseError");
      expect(error.message).toBe(
        `project ${id} is used by 3 rules, remove them first`,
      );
    }
    expect(projects).toHaveLength(1);
  });
  it("setProject without an id creates the Project", async () => {
    // Given: an empty store
    // When
    const { result, projects } = await useEmpty(
      Effect.gen(function* () {
        const store = yield* Store;
        const result = yield* setProject({ id: null, name: "Thesis" });
        const projects = yield* store.listProjects();
        return { result, projects };
      }),
    );
    // Then
    expect(result.name).toBe("Thesis");
    expect(result.id).toHaveLength(36);
    expect(projects).toEqual([result]);
  });

  it("setProject with no id creates the Project", async () => {
    // Given: an empty store
    // When: the input leaves id out
    const result = await useEmpty(setProject({ name: "Thesis" }));
    // Then
    expect(result).toMatchObject({ name: "Thesis" });
  });

  it("setProject with an id renames", async () => {
    // Given: an empty store with one project
    const { inserted, result } = await useEmpty(
      Effect.gen(function* () {
        const store = yield* Store;
        const inserted = yield* store.insertProject({ name: "Thesis" });
        // When
        const result = yield* setProject({
          id: inserted.id,
          name: "PhD thesis",
        });
        return { inserted, result };
      }),
    );
    // Then
    expect(result).toEqual({ id: inserted.id, name: "PhD thesis" });
  });

  it("setProject with an unknown id fails naming the id", async () => {
    // Given: an empty store
    // When
    const result = await useEmpty(
      Effect.either(
        setProject({
          id: "00000000-0000-4000-8000-000000000077",
          name: "X",
        }),
      ),
    );
    // Then
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      const error = result.left as ProjectNotFoundError;
      expect(error._tag).toBe("ProjectNotFoundError");
      expect(error.message).toBe(
        "project 00000000-0000-4000-8000-000000000077 not found",
      );
    }
  });
});
