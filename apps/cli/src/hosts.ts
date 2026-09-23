import { Data, Effect, Layer } from "effect";

import { claudeHost } from "./claude-host.js";
import { codexHost } from "./codex-host.js";
import { hermesHost } from "./hermes-host.js";
import type { Borders, RegisterOutcome, UnregisterOutcome } from "./host.js";
import { openclawHost } from "./openclaw-host.js";

export { serverEntry, serverNode } from "./host.js";

// Setup lists, ticks, and prints the Hosts in this order.
const hostList = [claudeHost, codexHost, hermesHost, openclawHost] as const;

type AnyHost = (typeof hostList)[number];

export type HostName = AnyHost["name"];

const byName = <A>(f: (host: AnyHost) => A) =>
  Object.fromEntries(hostList.map((h) => [h.name, f(h)])) as Record<
    HostName,
    A
  >;

const hosts = byName((h) => h);

export const hostNames: ReadonlyArray<HostName> = hostList.map((h) => h.name);

export const hostLabel = byName((h) => h.label);

export const hostTitle = byName((h) => h.title);

export const manualCommand = byName((h) => h.manualAdd);

export const manualRemoveCommand = byName((h) => h.manualRemove);

export class UnknownHostError extends Data.TaggedError("UnknownHostError")<{
  readonly names: ReadonlyArray<string>;
}> {
  override get message(): string {
    return this.names.length === 0
      ? "--hosts needs at least one name"
      : `unknown host: ${this.names.join(", ")}`;
  }
}

export class HostRemoveError extends Data.TaggedError("HostRemoveError")<{
  readonly host: HostName;
}> {
  override get message(): string {
    return `${hostTitle[this.host]} failed · run by hand: ${manualRemoveCommand[this.host]}`;
  }
}

export class Hosts extends Effect.Service<Hosts>()("Hosts", {
  succeed: {
    detect: (): Effect.Effect<Record<HostName, boolean>, never, Borders> =>
      Effect.all(byName((h) => h.detect)),
    register: (
      host: HostName,
    ): Effect.Effect<RegisterOutcome, never, Borders> => hosts[host].register,
    unregister: (
      host: HostName,
    ): Effect.Effect<UnregisterOutcome, HostRemoveError, Borders> =>
      hosts[host].unregister.pipe(
        Effect.flatMap((outcome) =>
          outcome === "failed"
            ? Effect.fail(new HostRemoveError({ host }))
            : Effect.succeed(outcome),
        ),
      ),
  },
}) {
  // biome-ignore lint/style/useNamingConvention: layers are PascalCase
  static Test = Layer.succeed(
    this,
    new Hosts({
      detect: () =>
        Effect.succeed({
          claude: false,
          codex: false,
          hermes: false,
          openclaw: false,
        }),
      register: () => Effect.succeed({ outcome: "registered" } as const),
      unregister: () => Effect.succeed("unregistered" as const),
    }),
  );
}
