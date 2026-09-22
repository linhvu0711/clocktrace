import {
  type App,
  type Helper,
  type HelperExitedError,
  type HelperNotFoundError,
  type Launchd,
  type LaunchdError,
  readStatus,
  Status,
} from "@clocktrace/collector";
import {
  ActivitiesPage,
  type AppStore,
  activities,
  addRule,
  type CategoryInUseError,
  type CategoryNotFoundError,
  type DatabaseNewerError,
  emptyNote,
  GroupBy,
  type InvalidRangeError,
  type InvalidRuleError,
  type ProjectInUseError,
  type ProjectNotFoundError,
  RuleCompare,
  RuleEffect,
  RuleField,
  type RuleNotFoundError,
  removeCategory,
  removeProject,
  removeRule,
  Store,
  type StoreError,
  Summary,
  setCategory,
  setProject,
  summary,
  TimelineBlock,
  timeline,
  usedRange,
} from "@clocktrace/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  Cause,
  type DateTime,
  Effect,
  Exit,
  type Layer,
  ManagedRuntime,
  Option,
  Schema,
} from "effect";
import type { ParseError } from "effect/ParseResult";
import { z } from "zod";

import type { NotInstalledError } from "./installed-store.js";
import { version } from "./version.js";

export type StoreLayerError =
  | StoreError
  | DatabaseNewerError
  | NotInstalledError;

export type Services =
  | Store
  | AppStore
  | Launchd
  | Helper
  | App
  | DateTime.CurrentTimeZone;

type ToolError =
  | InvalidRuleError
  | InvalidRangeError
  | RuleNotFoundError
  | CategoryNotFoundError
  | ProjectNotFoundError
  | CategoryInUseError
  | ProjectInUseError
  | HelperNotFoundError
  | HelperExitedError
  | LaunchdError
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
const RangeIn = z.object({ from: z.string(), to: z.string() });
const RangeOut = z.object({
  from: z.string(),
  to: z.string(),
  zone: z.string(),
});
const SummaryRowOut = z.object({
  key: z.string(),
  name: z.string(),
  seconds: z.number().int(),
  productive: z.boolean().optional(),
});
const TimelineBlockOut = z.object({
  start: z.string(),
  end: z.string(),
  app: z.string(),
  categoryName: z.string(),
  projectName: z.string().nullable(),
});
const ActivityOut = z.object({
  id: z.string(),
  deviceId: z.string(),
  bundleId: z.string(),
  appName: z.string(),
  title: z.string().nullable(),
  url: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string(),
});
const PermissionLineOut = z.object({
  name: z.string(),
  state: z.enum(["granted", "denied", "not checked"]),
  note: z.string().nullable(),
});
const IosImportOut = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ok"), at: z.string() }),
  z.object({ state: z.literal("broken"), reason: z.string() }),
  z.object({ state: z.literal("notTested"), macosVersion: z.string() }),
]);
const DeviceStatusOut = z.object({
  name: z.string(),
  kind: z.enum(["iphone", "ipad"]),
  lastSync: z.string().nullable(),
  sync: z.enum(["synced", "stale", "never"]),
  lastActivity: z.string().nullable(),
});

const instructions =
  "clocktrace is automatic time tracking for this Mac. Activities (app, window title, URL) are stored in a local SQLite database. Rules group them: a Rule sets a Category, sets a Project, or marks the Activity Private. Tools: list_categories, list_projects, list_rules, add_rule, remove_rule, remove_category, remove_project, set_category, set_project, summary, timeline, activities, status. summary, timeline, and activities take range { from, to }: local dates YYYY-MM-DD or local date-times YYYY-MM-DDTHH:mm; compute words like today or this week yourself. Every reply starts with the exact window used and its zone.";

const failureText = (cause: Cause.Cause<ToolError>): string =>
  Option.match(Cause.failureOption(cause), {
    onSome: (e) => e.message,
    onNone: () => {
      throw Cause.squash(cause);
    },
  });

export const makeServer = async (
  services: Layer.Layer<Services, StoreLayerError>,
): Promise<{ server: McpServer; dispose: () => Promise<void> }> => {
  const runtime = ManagedRuntime.make(services);
  const dispose = () => runtime.dispose();

  const run = async <A extends Record<string, unknown>>(
    effect: Effect.Effect<A, ToolError, Services>,
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
    "remove_category",
    {
      description: "Remove a Category by id. Fails if Rules still use it.",
      inputSchema: { id: z.string() },
      outputSchema: { removed: z.string() },
    },
    ({ id }) => run(Effect.as(removeCategory(id), { removed: id })),
  );

  server.registerTool(
    "remove_project",
    {
      description: "Remove a Project by id. Fails if Rules still use it.",
      inputSchema: { id: z.string() },
      outputSchema: { removed: z.string() },
    },
    ({ id }) => run(Effect.as(removeProject(id), { removed: id })),
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

  server.registerTool(
    "summary",
    {
      description:
        "Seconds per Category, Project, app, or Device in a range. range is { from, to }: each a local date YYYY-MM-DD or a local date-time YYYY-MM-DDTHH:mm in the user's zone; a bare from is midnight, a bare to is the whole of that day. Compute today, yesterday, or this week yourself and pass dates. device is a Device id, the key of groupBy device. The reply starts with range { from, to, zone }, the exact window used, then rows and total seconds.",
      inputSchema: {
        range: RangeIn,
        groupBy: z.enum(GroupBy.literals),
        device: z.string().optional(),
      },
      outputSchema: {
        range: RangeOut,
        rows: z.array(SummaryRowOut),
        total: z.number().int(),
        note: z.string().optional(),
      },
    },
    (input) =>
      run(
        Effect.gen(function* () {
          const range = yield* usedRange(input.range);
          const result = yield* summary({
            range: input.range,
            groupBy: input.groupBy,
            deviceId: input.device,
          });
          const encoded = yield* Schema.encode(Summary)(result);
          return { range, ...encoded, ...emptyNote(encoded.rows) };
        }),
      ),
  );

  server.registerTool(
    "timeline",
    {
      description:
        "Blocks of continuous time in one app and Category within a range, in time order, clipped to the window. Same range rules as summary. device is a Device id, the key of summary with groupBy device. The reply starts with range { from, to, zone }, then rows and total, the block count.",
      inputSchema: { range: RangeIn, device: z.string().optional() },
      outputSchema: {
        range: RangeOut,
        rows: z.array(TimelineBlockOut),
        total: z.number().int(),
        note: z.string().optional(),
      },
    },
    (input) =>
      run(
        Effect.gen(function* () {
          const range = yield* usedRange(input.range);
          const blocks = yield* timeline({
            range: input.range,
            deviceId: input.device,
          });
          const rows = yield* Schema.encode(Schema.Array(TimelineBlock))(
            blocks,
          );
          return { range, rows, total: rows.length, ...emptyNote(rows) };
        }),
      ),
  );

  server.registerTool(
    "activities",
    {
      description:
        "Raw Activities (app, window title, URL, start, end) in a range, in time order, at most 200 per call. hasMore true means more exist: narrow the range, or filter by app (bundle id or app name) or device (a Device id). Same range rules as summary. The reply starts with range { from, to, zone }, then rows, total, and hasMore.",
      inputSchema: {
        range: RangeIn,
        device: z.string().optional(),
        app: z.string().optional(),
        limit: z.number().int().positive().optional(),
      },
      outputSchema: {
        range: RangeOut,
        rows: z.array(ActivityOut),
        total: z.number().int(),
        hasMore: z.boolean(),
        note: z.string().optional(),
      },
    },
    (input) =>
      run(
        Effect.gen(function* () {
          const range = yield* usedRange(input.range);
          const page = yield* activities({
            range: input.range,
            deviceId: input.device,
            app: input.app,
            limit: input.limit,
          });
          const encoded = yield* Schema.encode(ActivitiesPage)(page);
          return { range, ...encoded, ...emptyNote(encoded.rows) };
        }),
      ),
  );

  server.registerTool(
    "status",
    {
      description:
        "Whether the Collector runs, whether the app that owns the grants is present, each permission with its state and what is lost while denied, the last Activity time, the iOS import state, and each iPhone and iPad with its last sync and last Activity, and the database path.",
      inputSchema: {},
      outputSchema: {
        collector: z.enum(["running", "stopped"]),
        app: z.enum(["present", "missing"]),
        permissions: z.array(PermissionLineOut),
        lastActivity: z.string().nullable(),
        iosImport: IosImportOut.nullable(),
        devices: z.array(DeviceStatusOut),
        databasePath: z.string(),
      },
    },
    () =>
      run(
        Effect.gen(function* () {
          const s = yield* readStatus();
          const encoded = yield* Schema.encode(Status)(s);
          return encoded;
        }),
      ),
  );

  return { server, dispose };
};
