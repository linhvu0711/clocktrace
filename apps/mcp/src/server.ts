import {
  type DatabaseNewerError,
  RuleCompare,
  RuleEffect,
  RuleField,
  Store,
  type StoreError,
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

import { version } from "./version.js";

export type StoreLayerError = StoreError | DatabaseNewerError;

type ToolError = StoreLayerError | ParseError;

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

const instructionsBase =
  "clocktrace is automatic time tracking for this Mac. Activities (app, window title, URL) are stored in a local SQLite database. Rules group them: a Rule sets a Category, sets a Project, or marks the Activity Private. Tools: list_categories, list_projects, list_rules, add_rule, remove_rule, set_category, set_project, finish_onboarding.";

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
      onFailure: (cause) =>
        Option.match(Cause.failureOption(cause), {
          onSome: (e) => ({
            content: [{ type: "text" as const, text: e.message }],
            isError: true,
          }),
          onNone: () => {
            throw Cause.squash(cause);
          },
        }),
    });
  };

  const server = new McpServer(
    { name: "clocktrace", version: version() },
    { instructions: instructionsBase },
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

  return { server, dispose };
};
