import { homedir } from "node:os";

import { App, CollectorPaths, Helper, Launchd } from "@clocktrace/collector";
import { NodeContext } from "@effect/platform-node";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DateTime, Effect, Layer } from "effect";

import { DbPath } from "./config.js";
import { InstalledStore } from "./installed-store.js";
import { makeServer } from "./server.js";

export const serveStdio = async (): Promise<void> => {
  const path = await Effect.runPromise(DbPath);
  const { server, dispose } = await makeServer(
    Layer.mergeAll(
      InstalledStore(path).pipe(
        Layer.provide(Layer.mergeAll(Launchd.Default, NodeContext.layer)),
      ),
      Launchd.Default,
      Helper.Default,
      App.Default,
      DateTime.layerCurrentZoneLocal,
    ).pipe(Layer.provideMerge(CollectorPaths.Default(homedir()))),
  );
  server.server.onclose = () => {
    void dispose();
  };
  await server.connect(new StdioServerTransport());
};
