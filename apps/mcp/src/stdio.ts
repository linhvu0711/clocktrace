import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Effect } from "effect";

import { DbPath } from "./config.js";
import { InstalledStore } from "./installed-store.js";
import { makeServer } from "./server.js";

export const serveStdio = async (): Promise<void> => {
  const path = await Effect.runPromise(DbPath);
  const { server, dispose } = await makeServer(InstalledStore(path));
  server.server.onclose = () => {
    void dispose();
  };
  await server.connect(new StdioServerTransport());
};
