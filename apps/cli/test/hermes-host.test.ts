import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Effect, Exit, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

import { hermesHost } from "../src/hermes-host.js";
import { type Borders, serverEntry, serverNode } from "../src/host.js";

const manualAdd = `add mcp_servers.clocktrace with command "${serverNode}" and args ["${serverEntry}", "mcp"] to ~/.hermes/config.yaml`;
const manualRemove = "remove mcp_servers.clocktrace from ~/.hermes/config.yaml";

// Hermes touches no binary, so it runs on NodeContext alone.
const unregister = () =>
  Effect.runPromise(
    Effect.exit(hermesHost.unregister.pipe(Effect.provide(NodeContext.layer))),
  );

// A FileSystem where another writer saves `path` right after each read of
// it: `save(n)` lands after read n, `null` deletes, `undefined` does nothing.
const otherWriter = (
  path: string,
  save: (read: number) => string | null | undefined,
) =>
  Layer.effect(
    FileSystem.FileSystem,
    Effect.map(FileSystem.FileSystem, (fs) => {
      let reads = 0;
      return {
        ...fs,
        readFileString: (p: string, encoding?: string) =>
          fs.readFileString(p, encoding).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                if (p !== path) {
                  return;
                }
                const text = save(reads++);
                if (text === null) {
                  rmSync(path);
                } else if (text !== undefined) {
                  writeFileSync(path, text);
                }
              }),
            ),
          ),
      };
    }),
  );

const raceHermes = <A>(
  op: Effect.Effect<A, never, Borders>,
  writer: ReturnType<typeof otherWriter>,
) =>
  Effect.runPromise(
    Effect.exit(
      op.pipe(Effect.provide(writer), Effect.provide(NodeContext.layer)),
    ),
  );

let home: string;

describe("hermes host", () => {
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "clocktrace-home-"));
    vi.stubEnv("HOME", home);
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("writes the hermes block and keeps other keys", async () => {
    // Given: ~/.hermes/config.yaml holds model: nous-1 and no mcp_servers
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    writeFileSync(path, "model: nous-1\n");
    // When
    const line = await Effect.runPromise(
      hermesHost.register.pipe(Effect.provide(NodeContext.layer)),
    );
    // Then
    expect(line).toEqual({ outcome: "registered" });
    expect(parse(readFileSync(path, "utf8"))).toEqual({
      model: "nous-1",
      // biome-ignore lint/style/useNamingConvention: the yaml key is snake_case
      mcp_servers: {
        clocktrace: { command: serverNode, args: [serverEntry, "mcp"] },
      },
    });
  });

  it("hermes rewrites an existing key", async () => {
    // Given: config.yaml holds a stale mcp_servers.clocktrace plus other keys
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    writeFileSync(
      path,
      'model: nous-1\nmcp_servers:\n  clocktrace:\n    command: clocktrace\n    args: ["mcp"]\n',
    );
    // When
    const line = await Effect.runPromise(
      hermesHost.register.pipe(Effect.provide(NodeContext.layer)),
    );
    // Then
    expect(line).toEqual({ outcome: "registered" });
    expect(parse(readFileSync(path, "utf8"))).toEqual({
      model: "nous-1",
      // biome-ignore lint/style/useNamingConvention: the yaml key is snake_case
      mcp_servers: {
        clocktrace: { command: serverNode, args: [serverEntry, "mcp"] },
      },
    });
  });

  it("hermes re-registration keeps the env map", async () => {
    // Given: config.yaml holds a clocktrace entry with env
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    writeFileSync(
      path,
      'mcp_servers:\n  clocktrace:\n    command: clocktrace\n    args: ["mcp"]\n    env:\n      CLOCKTRACE_DB: /work/db.db\n',
    );
    // When
    const line = await Effect.runPromise(
      hermesHost.register.pipe(Effect.provide(NodeContext.layer)),
    );
    // Then
    expect(line).toEqual({ outcome: "registered" });
    expect(parse(readFileSync(path, "utf8"))).toEqual({
      // biome-ignore lint/style/useNamingConvention: the yaml key is snake_case
      mcp_servers: {
        clocktrace: {
          command: serverNode,
          args: [serverEntry, "mcp"],
          // biome-ignore lint/style/useNamingConvention: the env key is the name
          env: { CLOCKTRACE_DB: "/work/db.db" },
        },
      },
    });
  });

  it("an unreadable hermes config fails by hand instead of overwriting", async () => {
    // Given: ~/.hermes/config.yaml exists but cannot be read
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    writeFileSync(path, "model: nous-1\n");
    chmodSync(path, 0o000);
    // When
    const line = await Effect.runPromise(
      hermesHost.register.pipe(Effect.provide(NodeContext.layer)),
    );
    chmodSync(path, 0o644);
    // Then
    expect(line).toEqual({
      outcome: "failed",
      byHand: manualAdd,
    });
    expect(readFileSync(path, "utf8")).toBe("model: nous-1\n");
  });

  it("a malformed hermes config fails by hand instead of crashing", async () => {
    // Given: ~/.hermes/config.yaml contains invalid YAML
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    writeFileSync(path, "model: [\n");
    // When
    const line = await Effect.runPromise(
      hermesHost.register.pipe(Effect.provide(NodeContext.layer)),
    );
    // Then
    expect(line).toEqual({
      outcome: "failed",
      byHand: manualAdd,
    });
    expect(readFileSync(path, "utf8")).toBe("model: [\n");
  });

  it("hermes setup keeps every byte outside the Registration", async () => {
    // Given: ~/.hermes/config.yaml with its own spacing and flow style
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    writeFileSync(path, "model: nous-1   # note\nother: {command: x}\n");
    // When
    const line = await Effect.runPromise(
      hermesHost.register.pipe(Effect.provide(NodeContext.layer)),
    );
    // Then
    expect(line).toEqual({ outcome: "registered" });
    expect(readFileSync(path, "utf8")).toBe(
      `model: nous-1   # note\nother: {command: x}\nmcp_servers:\n  clocktrace:\n    command: ${serverNode}\n    args:\n      - ${serverEntry}\n      - mcp\n`,
    );
  });

  it("a one-line hermes mcp_servers list fails by hand and leaves the file", async () => {
    // Given: mcp_servers is a one-line list that already holds a server
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    writeFileSync(path, "mcp_servers: {foo: {command: foo}}\n");
    // When
    const line = await Effect.runPromise(
      hermesHost.register.pipe(Effect.provide(NodeContext.layer)),
    );
    // Then
    expect(line).toEqual({
      outcome: "failed",
      byHand: manualAdd,
    });
    expect(readFileSync(path, "utf8")).toBe(
      "mcp_servers: {foo: {command: foo}}\n",
    );
  });

  it("a symlinked hermes config writes the target and keeps its mode", async () => {
    // Given: ~/.hermes/config.yaml is a symlink to a 0600 dotfiles file
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const target = join(home, "dotfiles", "hermes.yaml");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, "model: nous-1\n");
    chmodSync(target, 0o600);
    const link = join(home, ".hermes", "config.yaml");
    symlinkSync(target, link);
    // When
    const line = await Effect.runPromise(
      hermesHost.register.pipe(Effect.provide(NodeContext.layer)),
    );
    // Then
    expect(line).toEqual({ outcome: "registered" });
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, "utf8")).toContain("clocktrace");
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  it("hermes unregister removes the block and keeps other keys", async () => {
    // Given: config.yaml with a model and two servers
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    writeFileSync(
      path,
      'model: nous-1\nmcp_servers:\n  clocktrace:\n    command: clocktrace\n    args: ["mcp"]\n  other:\n    command: other\n',
    );
    // When
    const outcome = await unregister();
    // Then
    expect(outcome).toEqual(Exit.succeed("unregistered"));
    expect(parse(readFileSync(path, "utf8"))).toEqual({
      model: "nous-1",
      // biome-ignore lint/style/useNamingConvention: the yaml key is snake_case
      mcp_servers: { other: { command: "other" } },
    });
  });

  it("hermes unregister with the key absent leaves the file unchanged", async () => {
    // Given: config.yaml without mcp_servers.clocktrace
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    const text = "model: nous-1\n";
    writeFileSync(path, text);
    // When
    const outcome = await unregister();
    // Then
    expect(outcome).toEqual(Exit.succeed("not registered"));
    expect(readFileSync(path, "utf8")).toBe(text);
  });

  it("hermes unregister without a config file is not registered", async () => {
    // Given: no ~/.hermes at all
    // When
    const outcome = await unregister();
    // Then
    expect(outcome).toEqual(Exit.succeed("not registered"));
    expect(existsSync(join(home, ".hermes"))).toBe(false);
  });

  it("hermes unregister on a malformed config is failed", async () => {
    // Given: ~/.hermes/config.yaml contains invalid YAML
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    writeFileSync(path, "model: [\n");
    // When
    const outcome = await unregister();
    // Then
    expect(outcome).toEqual(Exit.succeed("failed"));
    expect(readFileSync(path, "utf8")).toBe("model: [\n");
  });

  it("hermes setup then uninstall gives back the file byte for byte", async () => {
    // Given: ~/.hermes/config.yaml with its own spacing, blank lines, and hex
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    const original =
      "model: nous-1   # note\nother: {command: x}\n\n\nz: 0x1F\n";
    writeFileSync(path, original);
    await Effect.runPromise(
      hermesHost.register.pipe(Effect.provide(NodeContext.layer)),
    );
    // When
    const outcome = await unregister();
    // Then
    expect(outcome).toEqual(Exit.succeed("unregistered"));
    expect(readFileSync(path, "utf8")).toBe(original);
  });

  it("hermes unregister on a one-line mcp_servers list is failed", async () => {
    // Given: the Registration sits inside a one-line mcp_servers list
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    writeFileSync(path, "mcp_servers: {clocktrace: {command: x}}\n");
    // When
    const outcome = await unregister();
    // Then
    expect(outcome).toEqual(Exit.succeed("failed"));
    expect(readFileSync(path, "utf8")).toBe(
      "mcp_servers: {clocktrace: {command: x}}\n",
    );
  });

  it("hermes register keeps a save made during the edit", async () => {
    // Given: Hermes saves config.yaml right after setup reads it
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    writeFileSync(path, "model: nous-1\n");
    const writer = otherWriter(path, (n) =>
      n === 0 ? "model: nous-2\n" : undefined,
    );
    // When
    const outcome = await raceHermes(hermesHost.register, writer);
    // Then
    expect(outcome).toEqual(Exit.succeed({ outcome: "registered" }));
    expect(parse(readFileSync(path, "utf8"))).toEqual({
      model: "nous-2",
      // biome-ignore lint/style/useNamingConvention: the yaml key is snake_case
      mcp_servers: {
        clocktrace: { command: serverNode, args: [serverEntry, "mcp"] },
      },
    });
  });

  it("hermes unregister keeps a save made during the edit", async () => {
    // Given: Hermes saves config.yaml right after uninstall reads it
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    const registered = (model: string) =>
      `model: ${model}\nmcp_servers:\n  clocktrace:\n    command: x\n`;
    writeFileSync(path, registered("nous-1"));
    const writer = otherWriter(path, (n) =>
      n === 0 ? registered("nous-2") : undefined,
    );
    // When
    const outcome = await raceHermes(hermesHost.unregister, writer);
    // Then
    expect(outcome).toEqual(Exit.succeed("unregistered"));
    expect(readFileSync(path, "utf8")).toBe("model: nous-2\n");
  });

  it("hermes gives up after 3 changed reads and keeps the other save", async () => {
    // Given: Hermes saves config.yaml after every read, so no try is clean
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    writeFileSync(path, "model: nous-1\n");
    let last = "";
    const writer = otherWriter(path, (n) => {
      last = `model: nous-${n + 2}\n`;
      return last;
    });
    // When
    const outcome = await raceHermes(hermesHost.register, writer);
    // Then
    expect(outcome).toEqual(
      Exit.succeed({ outcome: "failed", byHand: manualAdd }),
    );
    expect(readFileSync(path, "utf8")).toBe(last);
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it("hermes unregister gives up after 3 changed reads and is failed", async () => {
    // Given: Hermes saves config.yaml after every read, so no try is clean
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    const registered = (model: string) =>
      `model: ${model}\nmcp_servers:\n  clocktrace:\n    command: x\n`;
    writeFileSync(path, registered("nous-1"));
    let last = "";
    const writer = otherWriter(path, (n) => {
      last = registered(`nous-${n + 2}`);
      return last;
    });
    // When
    const outcome = await raceHermes(hermesHost.unregister, writer);
    // Then
    expect(outcome).toEqual(Exit.succeed("failed"));
    expect(readFileSync(path, "utf8")).toBe(last);
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it("hermes register after the file is deleted mid-edit writes only the registration", async () => {
    // Given: the user deletes config.yaml right after setup reads it
    mkdirSync(join(home, ".hermes"), { recursive: true });
    const path = join(home, ".hermes", "config.yaml");
    writeFileSync(path, "model: nous-1\n");
    const writer = otherWriter(path, (n) => (n === 0 ? null : undefined));
    // When
    const outcome = await raceHermes(hermesHost.register, writer);
    // Then
    expect(outcome).toEqual(Exit.succeed({ outcome: "registered" }));
    expect(parse(readFileSync(path, "utf8"))).toEqual({
      // biome-ignore lint/style/useNamingConvention: the yaml key is snake_case
      mcp_servers: {
        clocktrace: { command: serverNode, args: [serverEntry, "mcp"] },
      },
    });
  });

  it("manual commands name the config file", () => {
    expect([hermesHost.manualAdd, hermesHost.manualRemove]).toEqual([
      manualAdd,
      manualRemove,
    ]);
  });

  it("detects hermes by its config folder", async () => {
    // Given: ~/.hermes exists; then it does not
    const detect = () =>
      Effect.runPromise(
        hermesHost.detect.pipe(Effect.provide(NodeContext.layer)),
      );
    mkdirSync(join(home, ".hermes"));
    const found = await detect();
    rmSync(join(home, ".hermes"), { recursive: true });
    const missing = await detect();
    // Then
    expect([found, missing]).toEqual([true, false]);
  });
});
