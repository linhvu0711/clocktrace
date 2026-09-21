import { type ProjectNotFoundError, Store, setProject } from "@clocktrace/core";
import { Effect, Exit, Layer, Ref } from "effect";
import { describe, expect, it } from "vitest";
import {
  printProjects,
  printRemovedProject,
  printSetProject,
} from "../src/projects.js";
import { fakePrompt, type Prompt } from "../src/prompt.js";

const runPrint = <A, E>(body: Effect.Effect<A, E, Store | Prompt>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const prompt = yield* fakePrompt([], false);
      const exit = yield* Effect.exit(
        Effect.scoped(
          body.pipe(Effect.provide(Layer.merge(prompt.layer, Store.Test))),
        ),
      );
      const output = yield* Ref.get(prompt.output);
      return { exit, output };
    }),
  );

describe("projects", () => {
  it("list of no Projects prints none", async () => {
    // Given: Store.Test, whose Starter set holds no Project
    // When
    const { exit, output } = await runPrint(printProjects(false));
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual(["none"]);
  });

  it("set creates and prints it", async () => {
    // Given: Store.Test
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        // When
        yield* printSetProject({ id: null, name: "Thesis" }, false);
        return yield* store.listProjects();
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const projects = exit.value;
      expect(projects.length).toBe(1);
      expect(output).toEqual([`${projects[0]?.id}  Thesis`]);
    }
  });

  it("set --id renames", async () => {
    // Given: a Project named Thesis
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const p = yield* setProject({ id: null, name: "Thesis" });
        // When
        yield* printSetProject({ id: p.id, name: "PhD thesis" }, true);
        return p;
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(JSON.parse(output[0] ?? "")).toEqual({
        id: exit.value.id,
        name: "PhD thesis",
      });
    }
  });

  it("list --json prints the list_projects JSON", async () => {
    // Given: a Project named Thesis
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const p = yield* setProject({ id: null, name: "Thesis" });
        // When
        yield* printProjects(true);
        return p;
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(JSON.parse(output[0] ?? "")).toEqual({
        projects: [{ id: exit.value.id, name: "Thesis" }],
      });
    }
  });

  it("remove prints removed", async () => {
    // Given: one Project
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        const p = yield* setProject({ id: null, name: "Thesis" });
        // When
        yield* printRemovedProject(p.id, false);
        return { p, projects: yield* store.listProjects() };
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const { p, projects } = exit.value;
      expect(output).toEqual([`removed ${p.id}`]);
      expect(projects).toEqual([]);
    }
  });

  it("remove of an unknown id names the id", async () => {
    // Given: Store.Test
    // When
    const { exit, output } = await runPrint(
      printRemovedProject("00000000-0000-4000-8000-000000000077", false),
    );
    // Then
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
      const error = exit.cause.error as ProjectNotFoundError;
      expect(error.message).toBe(
        "project 00000000-0000-4000-8000-000000000077 not found",
      );
    }
    expect(output).toEqual([]);
  });
});
