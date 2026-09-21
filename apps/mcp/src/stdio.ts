import { Helper, Launchd } from "@clocktrace/collector";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DateTime, Effect, Layer } from "effect";

import { DbPath } from "./config.js";
import { InstalledStore } from "./installed-store.js";
import { makeServer } from "./server.js";

export const serveStdio = async (): Promise<void> => {
  const path = await Effect.runPromise(DbPath);
  const { server, dispose } = await makeServer(
    Layer.mergeAll(
      InstalledStore(path),
      Launchd.Default,
      Helper.Default,
      DateTime.layerCurrentZoneLocal,
    ),
  );
  server.server.onclose = () => {
    void dispose();
  };
  await server.connect(new StdioServerTransport());
};
