import { type ProjectNotFoundError, Store, setProject } from "@clocktrace/core";
import { NodeContext } from "@effect/platform-node";
import { Console, Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { Style } from "../src/format.js";
import {
  printProjects,
  printRemovedProject,
  printSetProject,
} from "../src/projects.js";
import { Prompt } from "../src/prompt.js";
import * as MockConsole from "./mock-console.js";
import * as MockTerminal from "./mock-terminal.js";

const runPrint = <A, E>(
  body: Effect.Effect<A, E, Store | Prompt | Style>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const terminal = yield* MockTerminal.make(false);
      const console = yield* MockConsole.make;
      const exit = yield* Effect.exit(
        Effect.scoped(
          body.pipe(
            Effect.provide(
              Layer.mergeAll(
                Console.setConsole(console),
                NodeContext.layer,
                terminal.layer,
                Prompt.Default,
                Store.Test,
                Style.Test,
              ),
            ),
          ),
        ),
      );
      const output = yield* console.getLines({ stripAnsi: true });
      return { exit, output };
    }),
  );

describe("projects", () => {
  it("list prints a header, one row per Project with the id last, and the count", async () => {
    // Given: one Project
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const p = yield* setProject({ id: null, name: "Thesis" });
        // When
        yield* printProjects(false);
        return p;
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(output).toEqual([
        "  name    id",
        `  Thesis  ${exit.value.id}`,
        "  1 project",
      ]);
    }
  });

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
      expect(output).toEqual([
        `✔ created project Thesis · ${projects[0]?.id}`,
      ]);
    }
  });

  it("set --id renames and prints updated", async () => {
    // Given: a Project named Thesis
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const p = yield* setProject({ id: null, name: "Thesis" });
        // When
        yield* printSetProject({ id: p.id, name: "Paper" }, false);
        return p;
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(output).toEqual([
        `✔ updated project Paper · ${exit.value.id}`,
      ]);
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
      expect(output).toEqual([`✔ removed project ${p.id}`]);
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
