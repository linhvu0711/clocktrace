import { Command } from "@effect/cli";
import { Effect } from "effect";

export const mcpCommand = Command.make("mcp", {}, () =>
  Effect.promise(async () => {
    const { serveStdio } = await import("@clocktrace/mcp");
    await serveStdio();
  }),
);
