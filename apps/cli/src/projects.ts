import {
  type Project,
  type ProjectInput,
  type ProjectInUseError,
  type ProjectNotFoundError,
  removeProject,
  Store,
  type StoreError,
  setProject,
} from "@clocktrace/core";
import { Args, Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import type { ParseError } from "effect/ParseResult";

import { type Cell, columns, count, line, span, Style } from "./format.js";
import { jsonOption, report } from "./output.js";
import type { Prompt } from "./prompt.js";
import { whenSetUp } from "./set-up.js";

export const projectLine = (p: Project): string => `${p.id}  ${p.name}`;

const projectRow = (p: Project): ReadonlyArray<Cell> => [
  `  ${p.name}`,
  span("dim", p.id),
];

export const printProjects = (
  json: boolean,
): Effect.Effect<void, StoreError, Store | Prompt | Style> =>
  Effect.gen(function* () {
    const store = yield* Store;
    const look = yield* Style;
    const projects = yield* store.listProjects();
    const header = [span("dim", "  name"), span("dim", "id")];
    yield* report(json, { projects }, ({ projects }) =>
      projects.length === 0
        ? ["none"]
        : [
            ...columns([header, ...projects.map(projectRow)], look),
            line(
              [
                span(
                  "dim",
                  `  ${count(projects.length, "project", "projects")}`,
                ),
              ],
              look,
            ),
          ],
    );
  });

export const printSetProject = (
  input: ProjectInput,
  json: boolean,
): Effect.Effect<
  void,
  ProjectNotFoundError | ParseError | StoreError,
  Store | Prompt
> =>
  Effect.gen(function* () {
    const p = yield* setProject(input);
    yield* report(json, p, (p) => [projectLine(p)]);
  });

export const printRemovedProject = (
  id: string,
  json: boolean,
): Effect.Effect<
  void,
  ProjectNotFoundError | ProjectInUseError | StoreError,
  Store | Prompt
> =>
  Effect.andThen(
    removeProject(id),
    report(json, { removed: id }, ({ removed }) => [`removed ${removed}`]),
  );

const id = Options.text("id").pipe(
  Options.optional,
  Options.withDescription("the project id to update; omit to create"),
);
const name = Options.text("name").pipe(
  Options.withDescription("the project name"),
);
const idArg = Args.text({ name: "id" });

const listCommand = Command.make("list", { json: jsonOption }, ({ json }) =>
  whenSetUp(printProjects(json)),
);

const setCommand = Command.make(
  "set",
  { id, name, json: jsonOption },
  ({ id, json, ...rest }) =>
    whenSetUp(printSetProject({ ...rest, id: Option.getOrNull(id) }, json)),
);

const removeCommand = Command.make(
  "remove",
  { json: jsonOption, id: idArg },
  ({ id, json }) => whenSetUp(printRemovedProject(id, json)),
);

export const projectsCommand = Command.make("projects").pipe(
  Command.withDescription("list, set, or remove projects"),
  Command.withSubcommands([listCommand, setCommand, removeCommand]),
);
