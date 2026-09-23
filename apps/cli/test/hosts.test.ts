import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NodeContext } from "@effect/platform-node";
import { Effect, Exit, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

import { type Borders, serverEntry, serverNode } from "../src/host.js";
import {
  HostRemoveError,
  Hosts,
  hostNames,
  hostTitle,
  manualRemoveCommand,
} from "../src/hosts.js";
import { fakeExecutor } from "./mock-executor.js";

// Every Host command exits 1, so only the config folders count.
const runHosts = <A, E>(op: (hosts: Hosts) => Effect.Effect<A, E, Borders>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const executor = yield* fakeExecutor({});
      return yield* Effect.exit(
        Effect.flatMap(Hosts, op).pipe(
          Effect.provide(Hosts.Default),
          Effect.provide(Layer.mergeAll(NodeContext.layer, executor.layer)),
        ),
      );
    }),
  );

let home: string;

describe("hosts", () => {
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "clocktrace-home-"));
    vi.stubEnv("HOME", home);
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("lists the Hosts in setup order", () => {
    expect([hostNames, hostTitle]).toEqual([
      ["claude", "codex", "hermes", "openclaw"],
      {
        claude: "Claude Code",
        codex: "Codex",
        hermes: "Hermes Agent",
        openclaw: "OpenClaw",
      },
    ]);
  });

  it("detect reports every Host by name", async () => {
    // Given: ~/.codex and ~/.hermes exist; no Host binary on PATH
    mkdirSync(join(home, ".codex"));
    mkdirSync(join(home, ".hermes"));
    // When
    const detected = await runHosts((h) => h.detect());
    // Then
    expect(detected).toEqual(
      Exit.succeed({
        claude: false,
        codex: true,
        hermes: true,
        openclaw: false,
      }),
    );
  });

  it("register goes to the named Host", async () => {
    // Given: ~/.hermes/config.yaml holds model: nous-1
    mkdirSync(join(home, ".hermes"));
    const path = join(home, ".hermes", "config.yaml");
    writeFileSync(path, "model: nous-1\n");
    // When
    const outcome = await runHosts((h) => h.register("hermes"));
    // Then
    expect(outcome).toEqual(Exit.succeed({ outcome: "registered" }));
    expect(parse(readFileSync(path, "utf8"))).toEqual({
      model: "nous-1",
      // biome-ignore lint/style/useNamingConvention: the yaml key is snake_case
      mcp_servers: {
        clocktrace: { command: serverNode, args: [serverEntry, "mcp"] },
      },
    });
  });

  it("a Host that fails to unregister is a HostRemoveError with its manual command", async () => {
    // Given: ~/.hermes/config.yaml is not valid YAML
    mkdirSync(join(home, ".hermes"));
    writeFileSync(join(home, ".hermes", "config.yaml"), "model: [\n");
    // When
    const outcome = await runHosts((h) => h.unregister("hermes"));
    // Then
    expect(outcome).toEqual(Exit.fail(new HostRemoveError({ host: "hermes" })));
    expect(new HostRemoveError({ host: "codex" }).message).toBe(
      `Codex failed · run by hand: ${manualRemoveCommand.codex}`,
    );
  });
});
