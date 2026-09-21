import {
  addRule,
  type CategoryNotFoundError,
  type DatabaseNewerError,
  type InvalidRuleError,
  type ProjectNotFoundError,
  RuleCompare,
  RuleEffect,
  RuleField,
  type RuleNotFoundError,
  removeRule,
  Store,
  type StoreError,
  setCategory,
  setProject,
} from "@clocktrace/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  Cause,
  Effect,
  Exit,
  type Layer,
  ManagedRuntime,
  Option,
} from "effect";
import type { ParseError } from "effect/ParseResult";
import { z } from "zod";

import type { NotInstalledError } from "./installed-store.js";
import { version } from "./version.js";

export type StoreLayerError =
  | StoreError
  | DatabaseNewerError
  | NotInstalledError;

type ToolError =
  | InvalidRuleError
  | RuleNotFoundError
  | CategoryNotFoundError
  | ProjectNotFoundError
  | StoreLayerError
  | ParseError;

const CategoryOut = z.object({
  id: z.string(),
  name: z.string(),
  productive: z.boolean(),
});
const ProjectOut = z.object({ id: z.string(), name: z.string() });
const RuleOut = z.object({
  id: z.string(),
  position: z.number().int(),
  field: z.enum(RuleField.literals),
  compare: z.enum(RuleCompare.literals),
  value: z.string(),
  effect: z.enum(RuleEffect.literals),
  target: z.string().nullable(),
});

const instructions =
  "clocktrace is automatic time tracking for this Mac. Activities (app, window title, URL) are stored in a local SQLite database. Rules group them: a Rule sets a Category, sets a Project, or marks the Activity Private. Tools: list_categories, list_projects, list_rules, add_rule, remove_rule, set_category, set_project.";

const failureText = (cause: Cause.Cause<ToolError>): string =>
  Option.match(Cause.failureOption(cause), {
    onSome: (e) => e.message,
    onNone: () => {
      throw Cause.squash(cause);
    },
  });

export const makeServer = async (
  store: Layer.Layer<Store, StoreLayerError>,
): Promise<{ server: McpServer; dispose: () => Promise<void> }> => {
  const runtime = ManagedRuntime.make(store);
  const dispose = () => runtime.dispose();

  const run = async <A extends Record<string, unknown>>(
    effect: Effect.Effect<A, ToolError, Store>,
  ): Promise<CallToolResult> => {
    const exit = await runtime.runPromiseExit(effect);
    return Exit.match(exit, {
      onSuccess: (value) => ({
        content: [{ type: "text" as const, text: JSON.stringify(value) }],
        structuredContent: value,
      }),
      onFailure: (cause) => ({
        content: [{ type: "text" as const, text: failureText(cause) }],
        isError: true,
      }),
    });
  };

  const server = new McpServer(
    { name: "clocktrace", version: version() },
    { instructions },
  );

  server.registerTool(
    "list_categories",
    {
      description: "List every Category with its productive flag.",
      inputSchema: {},
      outputSchema: { categories: z.array(CategoryOut) },
    },
    () =>
      run(
        Effect.map(
          Effect.flatMap(Store, (s) => s.listCategories()),
          (categories) => ({ categories }),
        ),
      ),
  );

  server.registerTool(
    "list_projects",
    {
      description: "List every Project.",
      inputSchema: {},
      outputSchema: { projects: z.array(ProjectOut) },
    },
    () =>
      run(
        Effect.map(
          Effect.flatMap(Store, (s) => s.listProjects()),
          (projects) => ({
            projects,
          }),
        ),
      ),
  );

  server.registerTool(
    "list_rules",
    {
      description: "List every Rule in position order.",
      inputSchema: {},
      outputSchema: { rules: z.array(RuleOut) },
    },
    () =>
      run(
        Effect.map(
          Effect.flatMap(Store, (s) => s.listRules()),
          (rules) => ({
            rules,
          }),
        ),
      ),
  );

  server.registerTool(
    "add_rule",
    {
      description:
        "Append a Rule. field: app, title, url, domain, device. compare: is, contains, starts with, ends with, matches (regex). effect: category or project needs target, the Category or Project id; private needs no target.",
      inputSchema: {
        field: z.enum(RuleField.literals),
        compare: z.enum(RuleCompare.literals),
        value: z.string(),
        effect: z.enum(RuleEffect.literals),
        target: z.string().nullable().optional(),
      },
      outputSchema: RuleOut.shape,
    },
    (input) => run(addRule({ ...input, target: input.target ?? null })),
  );

  server.registerTool(
    "remove_rule",
    {
      description: "Remove a Rule by id.",
      inputSchema: { id: z.string() },
      outputSchema: { removed: z.string() },
    },
    ({ id }) => run(Effect.as(removeRule(id), { removed: id })),
  );

  server.registerTool(
    "set_category",
    {
      description:
        "Create a Category (no id) or update its name and productive flag (with id).",
      inputSchema: {
        id: z.string().optional(),
        name: z.string(),
        productive: z.boolean(),
      },
      outputSchema: CategoryOut.shape,
    },
    (input) =>
      run(
        setCategory({
          id: input.id ?? null,
          name: input.name,
          productive: input.productive,
        }),
      ),
  );

  server.registerTool(
    "set_project",
    {
      description: "Create a Project (no id) or rename it (with id).",
      inputSchema: { id: z.string().optional(), name: z.string() },
      outputSchema: ProjectOut.shape,
    },
    (input) => run(setProject({ id: input.id ?? null, name: input.name })),
  );

  return { server, dispose };
};
