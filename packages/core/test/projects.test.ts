import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";

import type { ProjectNotFoundError } from "../src/index.js";
import { openStore, Store, setProject } from "../src/index.js";

const EmptyStore = Layer.scoped(
  Store,
  Effect.map(openStore(":memory:"), (shape) => new Store(shape)),
);

const useEmpty = <A, E>(effect: Effect.Effect<A, E, Store>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(EmptyStore)));

describe("projects", () => {
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
