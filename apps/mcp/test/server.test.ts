import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fakeLaunchd,
  Helper,
  HelperExitedError,
  Launchd,
  type LaunchdState,
  type Permissions,
} from "@clocktrace/collector";
import { openStore, Store, type StoreShape } from "@clocktrace/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ConfigProvider, DateTime, Effect, Layer, Ref, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InstalledStore } from "../src/installed-store.js";
import { makeServer, type StoreLayerError } from "../src/server.js";

const zone = DateTime.layerCurrentZone(
  DateTime.zoneUnsafeMakeNamed("America/Los_Angeles"),
);
const dbPath = "/Users/me/Library/Application Support/clocktrace/clocktrace.db";
const config = Layer.setConfigProvider(
  ConfigProvider.fromMap(
    new Map([
      ["CLOCKTRACE_HELPER", "/stub"],
      ["CLOCKTRACE_DB", dbPath],
    ]),
  ),
);

const connect = async (
  store: Layer.Layer<Store, StoreLayerError>,
  collector: Layer.Layer<Launchd | Helper> = Layer.merge(
    Launchd.Test,
    Helper.Test,
  ),
) => {
  const { server, dispose } = await makeServer(
    Layer.mergeAll(store, zone, collector, config),
  );
  const client = new Client({ name: "test-client", version: "0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  const close = async () => {
    await client.close();
    await server.close();
    await dispose();
  };
  return { client, close };
};

const EmptyStore = Layer.scoped(
  Store,
  Effect.map(openStore(":memory:"), (shape) => new Store(shape)),
);

const withActivities = (
  seed: (store: StoreShape) => Effect.Effect<unknown, unknown>,
) =>
  Layer.scoped(
    Store,
    Effect.map(
      Effect.tap(openStore(":memory:"), (shape) => Effect.orDie(seed(shape))),
      (shape) => new Store(shape),
    ),
  );

const t = (s: string) => DateTime.unsafeMake(s);

// Studio: Code 08:00 to 09:30Z, then Chrome to 09:40Z; 01:00 to 02:40 in Los Angeles
const seedDay = (store: StoreShape) =>
  Effect.gen(function* () {
    const studio = yield* store.getOrInsertDevice({
      kind: "mac",
      name: "Studio",
      externalId: "mac-1",
    });
    yield* store.insertActivity({
      deviceId: studio.id,
      bundleId: "com.microsoft.VSCode",
      appName: "Code",
      title: "a",
      url: null,
      startedAt: t("2026-09-18T08:00:00.000Z"),
      endedAt: t("2026-09-18T09:30:00.000Z"),
    });
    yield* store.insertActivity({
      deviceId: studio.id,
      bundleId: "com.google.Chrome",
      appName: "Google Chrome",
      title: "b",
      url: "https://github.com/acme/shop",
      startedAt: t("2026-09-18T09:30:00.000Z"),
      endedAt: t("2026-09-18T09:40:00.000Z"),
    });
    return studio;
  });

const seedMany = (store: StoreShape, count: number) =>
  Effect.gen(function* () {
    const studio = yield* store.getOrInsertDevice({
      kind: "mac",
      name: "Studio",
      externalId: "mac-1",
    });
    for (let i = 0; i < count; i++) {
      const startedAt = Date.UTC(2026, 8, 18, 8) + i * 60_000;
      yield* store.insertActivity({
        deviceId: studio.id,
        bundleId: "com.microsoft.VSCode",
        appName: "Code",
        title: null,
        url: null,
        startedAt: DateTime.unsafeMake(startedAt),
        endedAt: DateTime.unsafeMake(startedAt + 60_000),
      });
    }
  });

const seedTwoDevices = (store: StoreShape) =>
  Effect.gen(function* () {
    yield* seedDay(store);
    const laptop = yield* store.getOrInsertDevice({
      kind: "mac",
      name: "Laptop",
      externalId: "mac-2",
    });
    yield* store.insertActivity({
      deviceId: laptop.id,
      bundleId: "com.apple.Safari",
      appName: "Safari",
      title: "c",
      url: null,
      startedAt: t("2026-09-18T10:00:00.000Z"),
      endedAt: t("2026-09-18T10:05:00.000Z"),
    });
  });

const stubHelper = (p: Permissions) =>
  Layer.succeed(
    Helper,
    new Helper({
      check: () => Effect.void,
      lines: () => Stream.empty,
      permissions: () => Effect.succeed(p),
      request: () => Effect.succeed("asked"),
    }),
  );

const stoppedLaunchd = Layer.unwrapEffect(
  Effect.map(
    Ref.make<LaunchdState>({
      installed: true,
      running: false,
      plist: null,
      installs: 0,
    }),
    fakeLaunchd,
  ),
);

const day = { from: "2026-09-18", to: "2026-09-18" };
const dayWindow = {
  from: "2026-09-18T00:00",
  to: "2026-09-19T00:00",
  zone: "America/Los_Angeles",
};
const emptyDay = { from: "2026-01-01", to: "2026-01-01" };
const emptyWindow = {
  from: "2026-01-01T00:00",
  to: "2026-01-02T00:00",
  zone: "America/Los_Angeles",
};

const callTool = (
  client: Client,
  params: { name: string; arguments: Record<string, unknown> },
): Promise<CallToolResult> =>
  client.callTool(params) as Promise<CallToolResult>;

const text = (result: CallToolResult): string => {
  const block = result.content[0];
  return block !== undefined && block.type === "text" ? block.text : "";
};

describe("server", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clocktrace-"));
    path = join(dir, "clocktrace.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists the tools, none named finish_onboarding", async () => {
    // Given: a server over an in-memory store
    const { client, close } = await connect(Store.Test);
    // When
    const { tools } = await client.listTools();
    await close();
    // Then
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("finish_onboarding");
    expect(names).toEqual(
      expect.arrayContaining([
        "add_rule",
        "list_categories",
        "list_projects",
        "list_rules",
        "remove_category",
        "remove_project",
        "remove_rule",
        "set_category",
        "set_project",
      ]),
    );
  });

  it("every tool has an input schema and an output schema", async () => {
    // Given: the same
    const { client, close } = await connect(Store.Test);
    // When
    const { tools } = await client.listTools();
    await close();
    // Then
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.outputSchema?.type).toBe("object");
    }
  });

  it("instructions describe clocktrace and the tools, never Onboarding", async () => {
    // Given: a server over an in-memory store
    const { client, close } = await connect(Store.Test);
    // When
    const instructions = client.getInstructions();
    await close();
    // Then
    expect(instructions).toContain("clocktrace");
    expect(instructions).not.toContain("Onboarding");
    expect(instructions).not.toContain("finish_onboarding");
  });

  it("every tool returns not installed without a database", async () => {
    // Given: a server over a path whose file does not exist
    const { client, close } = await connect(InstalledStore(path));
    // When
    const results = [
      await callTool(client, { name: "list_categories", arguments: {} }),
      await callTool(client, { name: "list_projects", arguments: {} }),
      await callTool(client, { name: "list_rules", arguments: {} }),
      await callTool(client, {
        name: "add_rule",
        arguments: {
          field: "app",
          compare: "is",
          value: "x",
          effect: "private",
        },
      }),
      await callTool(client, { name: "remove_rule", arguments: { id: "x" } }),
      await callTool(client, {
        name: "remove_category",
        arguments: { id: "x" },
      }),
      await callTool(client, {
        name: "remove_project",
        arguments: { id: "x" },
      }),
      await callTool(client, {
        name: "set_category",
        arguments: { name: "X", productive: true },
      }),
      await callTool(client, {
        name: "set_project",
        arguments: { name: "X" },
      }),
    ];
    await close();
    // Then
    for (const result of results) {
      expect(result.isError).toBe(true);
      expect(text(result)).toBe("not set up, run clocktrace setup");
    }
    expect(existsSync(path)).toBe(false);
  });

  it("list_projects returns [] on a fresh database", async () => {
    // Given: a server over an in-memory store seeded with the Starter set
    const { client, close } = await connect(Store.Test);
    // When
    const result = await callTool(client, {
      name: "list_projects",
      arguments: {},
    });
    await close();
    // Then
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ projects: [] });
  });

  it("list_categories returns the Starter set", async () => {
    // Given: the same
    const { client, close } = await connect(Store.Test);
    // When
    const result = await callTool(client, {
      name: "list_categories",
      arguments: {},
    });
    await close();
    // Then
    expect(result.isError).toBeUndefined();
    const categories = result.structuredContent?.categories as ReadonlyArray<{
      id: string;
      name: string;
      productive: boolean;
    }>;
    expect(categories.map((c) => [c.name, c.productive])).toEqual([
      ["Coding", true],
      ["Communication", true],
      ["Design", true],
      ["Entertainment", false],
      ["Social", false],
      ["Writing", true],
    ]);
    for (const c of categories) {
      expect(c.id).toHaveLength(36);
    }
  });

  it("list_rules returns the Starter set", async () => {
    // Given: the same
    const { client, close } = await connect(Store.Test);
    // When
    const result = await callTool(client, {
      name: "list_rules",
      arguments: {},
    });
    await close();
    // Then
    expect(result.isError).toBeUndefined();
    const rules = result.structuredContent?.rules as ReadonlyArray<
      Record<string, unknown>
    >;
    expect(rules).toHaveLength(70);
    const { id: _id, ...first } = rules[0] as Record<string, unknown>;
    expect(first).toEqual({
      position: 0,
      field: "title",
      compare: "ends with",
      value: "(Incognito)",
      effect: "private",
      target: null,
    });
  });

  it("add_rule appends the Rule", async () => {
    // Given: a server over an empty store
    const { client, close } = await connect(EmptyStore);
    // When
    const added = await callTool(client, {
      name: "add_rule",
      arguments: {
        field: "title",
        compare: "ends with",
        value: "(Incognito)",
        effect: "private",
        target: null,
      },
    });
    const listed = await callTool(client, {
      name: "list_rules",
      arguments: {},
    });
    await close();
    // Then
    expect(added.isError).toBeUndefined();
    const { id, ...rule } = added.structuredContent as Record<string, unknown>;
    expect(rule).toEqual({
      position: 0,
      field: "title",
      compare: "ends with",
      value: "(Incognito)",
      effect: "private",
      target: null,
    });
    expect(id).toHaveLength(36);
    expect(listed.structuredContent).toEqual({
      rules: [{ id, ...rule }],
    });
  });

  it("add_rule rejects a bad field naming it", async () => {
    // Given: the same
    const { client, close } = await connect(EmptyStore);
    // When
    const result = await callTool(client, {
      name: "add_rule",
      arguments: {
        field: "window",
        compare: "is",
        value: "x",
        effect: "private",
      },
    });
    await close();
    // Then
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/at field$/);
  });

  it("add_rule rejects a bad compare naming it", async () => {
    // Given: the same
    const { client, close } = await connect(EmptyStore);
    // When
    const result = await callTool(client, {
      name: "add_rule",
      arguments: {
        field: "app",
        compare: "equals",
        value: "x",
        effect: "private",
      },
    });
    await close();
    // Then
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/at compare$/);
  });

  it("add_rule rejects a bad effect naming it", async () => {
    // Given: the same
    const { client, close } = await connect(EmptyStore);
    // When
    const result = await callTool(client, {
      name: "add_rule",
      arguments: {
        field: "app",
        compare: "is",
        value: "x",
        effect: "ignore",
      },
    });
    await close();
    // Then
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/at effect$/);
  });

  it("add_rule rejects an invalid regex naming value", async () => {
    // Given: the same
    const { client, close } = await connect(EmptyStore);
    // When
    const result = await callTool(client, {
      name: "add_rule",
      arguments: {
        field: "title",
        compare: "matches",
        value: "(",
        effect: "private",
      },
    });
    await close();
    // Then
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("value: not a valid regex");
  });

  it("add_rule rejects a regex that can backtrack catastrophically naming value", async () => {
    // Given: the same
    const { client, close } = await connect(EmptyStore);
    // When
    const result = await callTool(client, {
      name: "add_rule",
      arguments: {
        field: "title",
        compare: "matches",
        value: "(a+)+$",
        effect: "private",
      },
    });
    const listed = await callTool(client, {
      name: "list_rules",
      arguments: {},
    });
    await close();
    // Then
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("value: regex can backtrack catastrophically");
    expect(listed.structuredContent).toEqual({ rules: [] });
  });

  it("add_rule rejects a category rule with no target naming target", async () => {
    // Given: the same
    const { client, close } = await connect(EmptyStore);
    // When
    const result = await callTool(client, {
      name: "add_rule",
      arguments: {
        field: "app",
        compare: "is",
        value: "com.apple.Terminal",
        effect: "category",
      },
    });
    await close();
    // Then
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("target: a category rule needs a Category id");
  });

  it("remove_rule removes the Rule", async () => {
    // Given: an empty store with one rule added through add_rule
    const { client, close } = await connect(EmptyStore);
    const added = await callTool(client, {
      name: "add_rule",
      arguments: {
        field: "title",
        compare: "ends with",
        value: "(Incognito)",
        effect: "private",
        target: null,
      },
    });
    const id = (added.structuredContent as { id: string }).id;
    // When
    const removed = await callTool(client, {
      name: "remove_rule",
      arguments: { id },
    });
    const listed = await callTool(client, {
      name: "list_rules",
      arguments: {},
    });
    await close();
    // Then
    expect(removed.isError).toBeUndefined();
    expect(removed.structuredContent).toEqual({ removed: id });
    expect(listed.structuredContent).toEqual({ rules: [] });
  });

  it("set_category creates, then updates by id", async () => {
    // Given: a server over an empty store
    const { client, close } = await connect(EmptyStore);
    // When
    const created = await callTool(client, {
      name: "set_category",
      arguments: { name: "Research", productive: true },
    });
    const id = (created.structuredContent as { id: string }).id;
    const updated = await callTool(client, {
      name: "set_category",
      arguments: { id, name: "Reading", productive: false },
    });
    const listed = await callTool(client, {
      name: "list_categories",
      arguments: {},
    });
    await close();
    // Then
    expect(created.isError).toBeUndefined();
    const first = created.structuredContent as Record<string, unknown>;
    expect(first.name).toBe("Research");
    expect(first.productive).toBe(true);
    expect(id).toHaveLength(36);
    expect(updated.structuredContent).toEqual({
      id,
      name: "Reading",
      productive: false,
    });
    expect(listed.structuredContent).toEqual({
      categories: [{ id, name: "Reading", productive: false }],
    });
  });

  it("set_category with an unknown id names the id", async () => {
    // Given: the same
    const { client, close } = await connect(EmptyStore);
    // When
    const result = await callTool(client, {
      name: "set_category",
      arguments: {
        id: "00000000-0000-4000-8000-000000000077",
        name: "X",
        productive: true,
      },
    });
    await close();
    // Then
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      "category 00000000-0000-4000-8000-000000000077 not found",
    );
  });

  it("set_project creates, then renames by id", async () => {
    // Given: the same
    const { client, close } = await connect(EmptyStore);
    // When
    const created = await callTool(client, {
      name: "set_project",
      arguments: { name: "Thesis" },
    });
    const id = (created.structuredContent as { id: string }).id;
    const renamed = await callTool(client, {
      name: "set_project",
      arguments: { id, name: "PhD thesis" },
    });
    const listed = await callTool(client, {
      name: "list_projects",
      arguments: {},
    });
    await close();
    // Then
    expect(created.isError).toBeUndefined();
    const first = created.structuredContent as Record<string, unknown>;
    expect(first.name).toBe("Thesis");
    expect(id).toHaveLength(36);
    expect(renamed.structuredContent).toEqual({ id, name: "PhD thesis" });
    expect(listed.structuredContent).toEqual({
      projects: [{ id, name: "PhD thesis" }],
    });
  });

  it("set_project with an unknown id names the id", async () => {
    // Given: the same
    const { client, close } = await connect(EmptyStore);
    // When
    const result = await callTool(client, {
      name: "set_project",
      arguments: { id: "00000000-0000-4000-8000-000000000077", name: "X" },
    });
    await close();
    // Then
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      "project 00000000-0000-4000-8000-000000000077 not found",
    );
  });

  it("remove_category removes the Category", async () => {
    // Given: an empty store with a Category made through set_category
    const { client, close } = await connect(EmptyStore);
    const created = await callTool(client, {
      name: "set_category",
      arguments: { name: "Research", productive: true },
    });
    const id = (created.structuredContent as { id: string }).id;
    // When
    const removed = await callTool(client, {
      name: "remove_category",
      arguments: { id },
    });
    const listed = await callTool(client, {
      name: "list_categories",
      arguments: {},
    });
    await close();
    // Then
    expect(removed.isError).toBeUndefined();
    expect(removed.structuredContent).toEqual({ removed: id });
    expect(listed.structuredContent).toEqual({ categories: [] });
  });

  it("remove_category of an unknown id names the id", async () => {
    // Given: the same
    const { client, close } = await connect(EmptyStore);
    // When
    const result = await callTool(client, {
      name: "remove_category",
      arguments: { id: "00000000-0000-4000-8000-000000000077" },
    });
    await close();
    // Then
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      "category 00000000-0000-4000-8000-000000000077 not found",
    );
  });

  it("remove_project removes the Project", async () => {
    // Given: an empty store with a Project made through set_project
    const { client, close } = await connect(EmptyStore);
    const created = await callTool(client, {
      name: "set_project",
      arguments: { name: "Thesis" },
    });
    const id = (created.structuredContent as { id: string }).id;
    // When
    const removed = await callTool(client, {
      name: "remove_project",
      arguments: { id },
    });
    const listed = await callTool(client, {
      name: "list_projects",
      arguments: {},
    });
    await close();
    // Then
    expect(removed.isError).toBeUndefined();
    expect(removed.structuredContent).toEqual({ removed: id });
    expect(listed.structuredContent).toEqual({ projects: [] });
  });

  it("remove_project of an unknown id names the id", async () => {
    // Given: the same
    const { client, close } = await connect(EmptyStore);
    // When
    const result = await callTool(client, {
      name: "remove_project",
      arguments: { id: "00000000-0000-4000-8000-000000000077" },
    });
    await close();
    // Then
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      "project 00000000-0000-4000-8000-000000000077 not found",
    );
  });

  it("add_rule accepts a Category made by set_category as target", async () => {
    // Given: the same, plus a Category made through set_category
    const { client, close } = await connect(EmptyStore);
    const created = await callTool(client, {
      name: "set_category",
      arguments: { name: "Coding", productive: true },
    });
    const id = (created.structuredContent as { id: string }).id;
    // When
    const result = await callTool(client, {
      name: "add_rule",
      arguments: {
        field: "app",
        compare: "is",
        value: "com.apple.Terminal",
        effect: "category",
        target: id,
      },
    });
    await close();
    // Then
    expect(result.isError).toBeUndefined();
    const rule = result.structuredContent as Record<string, unknown>;
    expect(rule.target).toBe(id);
    expect(rule.position).toBe(0);
  });

  it("remove_rule of an unknown id names the id", async () => {
    // Given: the same
    const { client, close } = await connect(EmptyStore);
    // When
    const result = await callTool(client, {
      name: "remove_rule",
      arguments: { id: "00000000-0000-4000-8000-000000000099" },
    });
    await close();
    // Then
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      "rule 00000000-0000-4000-8000-000000000099 not found",
    );
  });

  it("lists the four question tools", async () => {
    // Given: a server over an in-memory store
    const { client, close } = await connect(Store.Test);
    // When
    const { tools } = await client.listTools();
    await close();
    // Then
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(["status", "summary", "timeline", "activities"]),
    );
  });

  it("instructions name the four question tools and the range format", async () => {
    // Given: the same
    const { client, close } = await connect(Store.Test);
    // When
    const instructions = client.getInstructions();
    await close();
    // Then
    expect(instructions).toContain("summary, timeline, activities, status");
    expect(instructions).toContain("YYYY-MM-DDTHH:mm");
  });

  it("the four question tools return not installed without a database", async () => {
    // Given: a server over a path whose file does not exist
    const { client, close } = await connect(InstalledStore(path));
    // When
    const results = [
      await callTool(client, {
        name: "summary",
        arguments: { range: day, groupBy: "app" },
      }),
      await callTool(client, { name: "timeline", arguments: { range: day } }),
      await callTool(client, {
        name: "activities",
        arguments: { range: day },
      }),
      await callTool(client, { name: "status", arguments: {} }),
    ];
    await close();
    // Then
    for (const result of results) {
      expect(result.isError).toBe(true);
      expect(text(result)).toBe("not set up, run clocktrace setup");
    }
    expect(existsSync(path)).toBe(false);
  });

  it("summary by app answers with the window first, then rows and total", async () => {
    // Given: a server over the seeded day, zone Los Angeles
    const { client, close } = await connect(withActivities(seedDay));
    // When
    const result = await callTool(client, {
      name: "summary",
      arguments: { range: day, groupBy: "app" },
    });
    await close();
    // Then: a bare to is the next midnight, rows sort by seconds
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      range: dayWindow,
      rows: [
        { key: "com.microsoft.VSCode", name: "Code", seconds: 5400 },
        { key: "com.google.Chrome", name: "Google Chrome", seconds: 600 },
      ],
      total: 6000,
    });
    expect(Object.keys(result.structuredContent ?? {})).toEqual([
      "range",
      "rows",
      "total",
    ]);
  });

  it("a timed range is echoed as given and clips the rows", async () => {
    // Given: the same
    const { client, close } = await connect(withActivities(seedDay));
    // When: 01:00 to 02:15 local is 08:00 to 09:15Z
    const result = await callTool(client, {
      name: "summary",
      arguments: {
        range: { from: "2026-09-18T01:00", to: "2026-09-18T02:15" },
        groupBy: "category",
      },
    });
    await close();
    // Then
    expect(result.structuredContent).toEqual({
      range: {
        from: "2026-09-18T01:00",
        to: "2026-09-18T02:15",
        zone: "America/Los_Angeles",
      },
      rows: [{ key: "uncategorized", name: "Uncategorized", seconds: 4500 }],
      total: 4500,
    });
  });

  it("an empty range gives no rows, total 0, and a note", async () => {
    // Given: the same
    const { client, close } = await connect(withActivities(seedDay));
    // When
    const result = await callTool(client, {
      name: "summary",
      arguments: { range: emptyDay, groupBy: "app" },
    });
    await close();
    // Then
    expect(result.structuredContent).toEqual({
      range: emptyWindow,
      rows: [],
      total: 0,
      note: "no activity in this range",
    });
  });

  it("a word range is an error naming range", async () => {
    // Given: the same
    const { client, close } = await connect(withActivities(seedDay));
    // When
    const result = await callTool(client, {
      name: "summary",
      arguments: { range: { from: "today", to: "today" }, groupBy: "app" },
    });
    await close();
    // Then
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      'range: from "today" is not YYYY-MM-DD or YYYY-MM-DDTHH:mm',
    );
  });

  it("to before from is an error naming range", async () => {
    // Given: the same
    const { client, close } = await connect(withActivities(seedDay));
    // When
    const result = await callTool(client, {
      name: "summary",
      arguments: {
        range: { from: "2026-09-08", to: "2026-09-01" },
        groupBy: "app",
      },
    });
    await close();
    // Then
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("range: from 2026-09-08 is after to 2026-09-01");
  });

  it("an unknown groupBy is an error naming groupBy", async () => {
    // Given: the same
    const { client, close } = await connect(withActivities(seedDay));
    // When
    const result = await callTool(client, {
      name: "summary",
      arguments: { range: day, groupBy: "week" },
    });
    await close();
    // Then
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/at groupBy$/);
  });

  it("timeline answers with the window first, then blocks in order", async () => {
    // Given: the same
    const { client, close } = await connect(withActivities(seedDay));
    // When
    const result = await callTool(client, {
      name: "timeline",
      arguments: { range: day },
    });
    await close();
    // Then: no Rules, so every block is Uncategorized
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      range: dayWindow,
      rows: [
        {
          start: "2026-09-18T08:00:00.000Z",
          end: "2026-09-18T09:30:00.000Z",
          app: "Code",
          categoryName: "Uncategorized",
          projectName: null,
        },
        {
          start: "2026-09-18T09:30:00.000Z",
          end: "2026-09-18T09:40:00.000Z",
          app: "Google Chrome",
          categoryName: "Uncategorized",
          projectName: null,
        },
      ],
      total: 2,
    });
    expect(Object.keys(result.structuredContent ?? {})).toEqual([
      "range",
      "rows",
      "total",
    ]);
  });

  it("timeline of an empty range gives no rows, total 0, and a note", async () => {
    // Given: the same
    const { client, close } = await connect(withActivities(seedDay));
    // When
    const result = await callTool(client, {
      name: "timeline",
      arguments: { range: emptyDay },
    });
    await close();
    // Then
    expect(result.structuredContent).toEqual({
      range: emptyWindow,
      rows: [],
      total: 0,
      note: "no activity in this range",
    });
  });

  it("activities answers with the window, the rows, the total, and hasMore false", async () => {
    // Given: the same
    const { client, close } = await connect(withActivities(seedDay));
    // When
    const result = await callTool(client, {
      name: "activities",
      arguments: { range: day },
    });
    await close();
    // Then
    expect(result.isError).toBeUndefined();
    const page = result.structuredContent as {
      range: unknown;
      rows: ReadonlyArray<Record<string, unknown>>;
      total: number;
      hasMore: boolean;
    };
    expect(page.range).toEqual(dayWindow);
    expect(page.rows).toHaveLength(2);
    expect(page.rows[0]).toMatchObject({
      bundleId: "com.microsoft.VSCode",
      appName: "Code",
      title: "a",
      url: null,
      startedAt: "2026-09-18T08:00:00.000Z",
      endedAt: "2026-09-18T09:30:00.000Z",
    });
    expect(page.total).toBe(2);
    expect(page.hasMore).toBe(false);
    expect(Object.keys(page)).toEqual(["range", "rows", "total", "hasMore"]);
  });

  it("activities over the cap returns 200 rows, hasMore true, and the total", async () => {
    // Given: 205 one-minute Code Activities from 08:00Z
    const { client, close } = await connect(
      withActivities((store) => seedMany(store, 205)),
    );
    // When
    const result = await callTool(client, {
      name: "activities",
      arguments: { range: day },
    });
    await close();
    // Then
    const page = result.structuredContent as {
      rows: ReadonlyArray<unknown>;
      total: number;
      hasMore: boolean;
    };
    expect(page.rows).toHaveLength(200);
    expect(page.total).toBe(205);
    expect(page.hasMore).toBe(true);
  });

  it("activities filters by app", async () => {
    // Given: the seeded day
    const { client, close } = await connect(withActivities(seedDay));
    // When
    const result = await callTool(client, {
      name: "activities",
      arguments: { range: day, app: "com.google.Chrome" },
    });
    await close();
    // Then
    const page = result.structuredContent as {
      rows: ReadonlyArray<{ appName: string }>;
      total: number;
      hasMore: boolean;
    };
    expect(page.total).toBe(1);
    expect(page.rows[0]?.appName).toBe("Google Chrome");
    expect(page.hasMore).toBe(false);
  });

  it("activities filters by device", async () => {
    // Given: two Devices, Studio with two Activities and Laptop with one
    const { client, close } = await connect(withActivities(seedTwoDevices));
    const byDevice = await callTool(client, {
      name: "summary",
      arguments: { range: day, groupBy: "device" },
    });
    const devices = (
      byDevice.structuredContent as {
        rows: ReadonlyArray<{ key: string; name: string }>;
      }
    ).rows;
    const studioId = devices.find((d) => d.name === "Studio")?.key ?? "";
    // When: the key of groupBy device is the device filter
    const result = await callTool(client, {
      name: "activities",
      arguments: { range: day, device: studioId },
    });
    await close();
    // Then
    expect(devices.map((d) => d.name)).toEqual(["Studio", "Laptop"]);
    expect(studioId).toHaveLength(36);
    const page = result.structuredContent as {
      rows: ReadonlyArray<{ deviceId: string }>;
      total: number;
    };
    expect(page.total).toBe(2);
    for (const row of page.rows) {
      expect(row.deviceId).toBe(studioId);
    }
  });

  it("activities of an empty range gives no rows, total 0, hasMore false, and a note", async () => {
    // Given: the seeded day
    const { client, close } = await connect(withActivities(seedDay));
    // When
    const result = await callTool(client, {
      name: "activities",
      arguments: { range: emptyDay },
    });
    await close();
    // Then
    expect(result.structuredContent).toEqual({
      range: emptyWindow,
      rows: [],
      total: 0,
      hasMore: false,
      note: "no activity in this range",
    });
  });

  it("status wraps readStatus: running, permissions, no Activity yet, imports not built yet", async () => {
    // Given: an empty store, the Test Launchd (running) and Helper (all granted)
    const { client, close } = await connect(EmptyStore);
    // When
    const result = await callTool(client, { name: "status", arguments: {} });
    await close();
    // Then
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      collector: "running",
      permissions: [
        { name: "accessibility", state: "granted", note: null },
        { name: "full disk access", state: "granted", note: null },
      ],
      lastActivity: null,
      databasePath: dbPath,
      imports: "not built yet",
      lines: [
        "collector: running",
        "accessibility: granted",
        "full disk access: granted",
        "last activity: none yet",
        `database: ${dbPath}`,
      ],
    });
  });

  it("status returns isError with the Helper failure text", async () => {
    // Given: the Test Launchd (running) and a Helper that exits with an error
    const failingHelper = Layer.succeed(
      Helper,
      new Helper({
        check: () => Effect.void,
        lines: () => Stream.empty,
        permissions: () =>
          Effect.fail(new HelperExitedError({ cause: "boom" })),
        request: () => Effect.succeed("asked"),
      }),
    );
    const { client, close } = await connect(
      EmptyStore,
      Layer.merge(Launchd.Test, failingHelper),
    );
    // When
    const result = await callTool(client, { name: "status", arguments: {} });
    await close();
    // Then
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("helper exited: boom");
    expect(text(result).length).toBeGreaterThan(0);
  });

  it("status reports the last Activity time", async () => {
    // Given: the seeded day, last Activity ends 09:40Z, 02:40 in Los Angeles
    const { client, close } = await connect(withActivities(seedDay));
    // When
    const result = await callTool(client, { name: "status", arguments: {} });
    await close();
    // Then
    const status = result.structuredContent as {
      lastActivity: string | null;
      lines: ReadonlyArray<string>;
    };
    expect(status.lastActivity).toBe("2026-09-18T09:40:00.000Z");
    expect(status.lines).toContain("last activity: 2026-09-18 02:40");
  });

  it("a stopped Collector: status says stopped, run clocktrace start, and summary still answers", async () => {
    // Given: the seeded day, a stopped Launchd, accessibility denied
    const { client, close } = await connect(
      withActivities(seedDay),
      Layer.merge(
        stoppedLaunchd,
        stubHelper({
          accessibility: "denied",
          automation: {},
          fullDiskAccess: "granted",
        }),
      ),
    );
    // When
    const status = await callTool(client, { name: "status", arguments: {} });
    const summary = await callTool(client, {
      name: "summary",
      arguments: { range: day, groupBy: "app" },
    });
    await close();
    // Then
    const s = status.structuredContent as {
      collector: string;
      permissions: ReadonlyArray<unknown>;
      lines: ReadonlyArray<string>;
    };
    expect(s.collector).toBe("stopped");
    expect(s.lines[0]).toBe("collector: stopped, run clocktrace start");
    expect(s.permissions[0]).toEqual({
      name: "accessibility",
      state: "denied",
      note: "window titles are not tracked",
    });
    expect(summary.isError).toBeUndefined();
    expect(summary.structuredContent?.total).toBe(6000);
  });
});
