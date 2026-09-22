import { Command } from "@effect/cli";
import { Data, Effect } from "effect";

export class McpStartupError extends Data.TaggedError("McpStartupError")<{
  readonly cause: unknown;
}> {
  override get message(): string {
    return `could not start the MCP server: ${String(this.cause)}`;
  }
}

const defaultServe = (): Promise<void> =>
  import("@clocktrace/mcp").then(({ serveStdio }) => serveStdio());

// `Effect.tryPromise`, not `Effect.promise`: a startup rejection must land in
// the error channel as a tagged error so the entry point's `catchAll` prints
// it, rather than becoming a defect that bypasses the CLI's error handling.
export const startMcp = (
  serve: () => Promise<void> = defaultServe,
): Effect.Effect<void, McpStartupError> =>
  Effect.tryPromise({
    try: serve,
    catch: (cause) => new McpStartupError({ cause }),
  });

export const mcpCommand = Command.make("mcp", {}, () => startMcp()).pipe(
  Command.withDescription("start the MCP server for AI hosts"),
);
