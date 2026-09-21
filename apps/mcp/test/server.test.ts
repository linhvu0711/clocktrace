import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, Store } from "@clocktrace/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Effect, Layer, Option } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InstalledStore } from "../src/installed-store.js";
import { makeServer, type StoreLayerError } from "../src/server.js";

const connect = async (layer: Layer.Layer<Store, StoreLayerError>) => {
  const { server, dispose } = await makeServer(layer);
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

  it("lists the eight tools", async () => {
    // Given: a server over an in-memory store
    const { client, close } = await connect(Store.Test);
    // When
    const { tools } = await client.listTools();
    await close();
    // Then
    expect(tools.map((t) => t.name).sort()).toEqual([
      "add_rule",
      "finish_onboarding",
      "list_categories",
      "list_projects",
      "list_rules",
      "remove_rule",
      "set_category",
      "set_project",
    ]);
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

  it("instructions offer Onboarding while the flag is off", async () => {
    // Given: the same
    const { client, close } = await connect(Store.Test);
    // When
    const instructions = client.getInstructions();
    await close();
    // Then
    expect(instructions).toContain("Onboarding is not done.");
    expect(instructions).toContain("Offer it once");
    expect(instructions).toContain("Never block on it");
    expect(instructions).not.toContain("Onboarding is done.");
  });

  it("finish_onboarding sets the flag", async () => {
    // Given: a server over a real database file
    const { client, close } = await connect(Store.Default(path));
    // When
    const result = await callTool(client, {
      name: "finish_onboarding",
      arguments: {},
    });
    await close();
    const setting = await Effect.runPromise(
      Effect.flatMap(Store, (s) => s.getSetting("onboarding")).pipe(
        Effect.provide(Store.Default(path)),
      ),
    );
    // Then
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ onboarding: "done" });
    expect(setting).toEqual(Option.some("1"));
  });

  it("instructions say Onboarding is done on the next start", async () => {
    // Given: a server where finish_onboarding was already called, closed
    const first = await connect(Store.Default(path));
    await callTool(first.client, {
      name: "finish_onboarding",
      arguments: {},
    });
    await first.close();
    // When: a second server on the same database
    const { client, close } = await connect(Store.Default(path));
    const instructions = client.getInstructions();
    await close();
    // Then
    expect(instructions).toContain("Onboarding is done.");
    expect(instructions).not.toContain("Offer it once");
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
        name: "set_category",
        arguments: { name: "X", productive: true },
      }),
      await callTool(client, {
        name: "set_project",
        arguments: { name: "X" },
      }),
      await callTool(client, { name: "finish_onboarding", arguments: {} }),
    ];
    const instructions = client.getInstructions();
    await close();
    // Then
    for (const result of results) {
      expect(result.isError).toBe(true);
      expect(text(result)).toBe(
        "clocktrace is not installed, run clocktrace install",
      );
    }
    expect(existsSync(path)).toBe(false);
    expect(instructions).toContain(
      "clocktrace is not installed, run clocktrace install",
    );
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
    expect(rules).toHaveLength(69);
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
});
