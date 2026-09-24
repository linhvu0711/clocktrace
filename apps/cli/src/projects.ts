import {
  type InvalidInputError,
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

import {
  type Cell,
  columns,
  count,
  type Look,
  line,
  mark,
  Style,
  span,
  text,
} from "./format.js";
import { jsonOption, report } from "./output.js";
import type { Prompt } from "./prompt.js";
import { whenSetUp } from "./set-up.js";

const projectRow = (p: Project): ReadonlyArray<Cell> => [
  `  ${text(p.name)}`,
  span("dim", p.id),
];

export const printProjects = (
  json: boolean,
): Effect.Effect<void, StoreError, Store | Prompt | Style> =>
  Effect.gen(function* () {
    const store = yield* Store;
    const look: Look = json
      ? { color: false, unicode: true, width: 0 }
      : yield* Style;
    const projects = yield* store.listProjects();
    const header = [span("dim", "  name"), span("dim", "id")];
    yield* report(json, { projects }, ({ projects }) =>
      projects.length === 0
        ? ["none"]
        : [
            ...columns([header, ...projects.map(projectRow)], look, {
              overflow: "keep",
            }),
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
  InvalidInputError | ProjectNotFoundError | ParseError | StoreError,
  Store | Prompt | Style
> =>
  Effect.gen(function* () {
    const look: Look = json
      ? { color: false, unicode: true, width: 0 }
      : yield* Style;
    const p = yield* setProject(input);
    const verb = input.id === null ? "created" : "updated";
    yield* report(json, p, (p) => [
      line(
        [
          mark("ok", look),
          ` ${verb} project ${text(p.name)} `,
          span("dim", `· ${p.id}`),
        ],
        look,
      ),
    ]);
  });

export const printRemovedProject = (
  id: string,
  json: boolean,
): Effect.Effect<
  void,
  ProjectNotFoundError | ProjectInUseError | StoreError,
  Store | Prompt | Style
> =>
  Effect.gen(function* () {
    const look: Look = json
      ? { color: false, unicode: true, width: 0 }
      : yield* Style;
    yield* removeProject(id);
    yield* report(json, { removed: id }, ({ removed }) => [
      line([mark("ok", look), ` removed project ${removed}`], look),
    ]);
  });

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
