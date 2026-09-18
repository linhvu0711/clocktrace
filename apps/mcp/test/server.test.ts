import { Store } from "@clocktrace/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Layer } from "effect";
import { describe, expect, it } from "vitest";

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

describe("server", () => {
  it("list_projects returns [] on a fresh database", async () => {
    // Given: a server over an in-memory store seeded with the Starter set
    const { client, close } = await connect(Store.Test);
    // When
    const result = await client.callTool({
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
    const result = await client.callTool({
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
    const result = await client.callTool({
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
});
