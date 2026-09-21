import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Command, CommandExecutor, FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Data, Effect, Layer, Ref, Schema } from "effect";

import { collectorLabel } from "./plist.js";

export const LaunchdState = Schema.Struct({
  installed: Schema.Boolean,
  running: Schema.Boolean,
  plist: Schema.NullOr(Schema.String),
  installs: Schema.Number,
});

export type LaunchdState = Schema.Schema.Type<typeof LaunchdState>;

export const fakeLaunchd = (
  state: Ref.Ref<LaunchdState>,
): Layer.Layer<Launchd> =>
  Layer.succeed(
    Launchd,
    new Launchd({
      isInstalled: () => Ref.get(state).pipe(Effect.map((s) => s.installed)),
      install: (plist) =>
        Ref.update(state, (s) => ({
          installed: true,
          running: true,
          plist,
          installs: s.installs + 1,
        })),
      bootstrap: () => Ref.update(state, (s) => ({ ...s, running: true })),
      bootout: () => Ref.update(state, (s) => ({ ...s, running: false })),
      state: () =>
        Ref.get(state).pipe(
          Effect.map((s) => (s.running ? "running" : "stopped")),
        ),
    }),
  );

export class LaunchdError extends Data.TaggedError("LaunchdError")<{
  readonly step: string;
  readonly detail: string;
}> {
  override get message(): string {
    return `${this.step}: ${this.detail}`;
  }
}

export type CollectorState = "running" | "stopped";

export const stateFromPrint = (lines: ReadonlyArray<string>): CollectorState =>
  lines.some((l) => l.trim() === "state = running") ? "running" : "stopped";

export const plistPath = join(
  homedir(),
  "Library",
  "LaunchAgents",
  `${collectorLabel}.plist`,
);

export const logPath = join(
  homedir(),
  "Library",
  "Logs",
  "clocktrace",
  "collector.log",
);

export const entryPath = fileURLToPath(new URL("./main.js", import.meta.url));

export class Launchd extends Effect.Service<Launchd>()("Launchd", {
  effect: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const executor = yield* CommandExecutor.CommandExecutor;
    const getuid = process.getuid;
    if (getuid === undefined) {
      return yield* Effect.die(new Error("launchd needs a POSIX uid"));
    }
    const domain = `gui/${getuid()}`;
    const exit = (step: string, ...args: ReadonlyArray<string>) =>
      Command.make("launchctl", ...args).pipe(
        Command.exitCode,
        Effect.provideService(CommandExecutor.CommandExecutor, executor),
        Effect.mapError(
          (cause) => new LaunchdError({ step, detail: String(cause) }),
        ),
      );
    const state = () =>
      Command.make("launchctl", "print", `${domain}/${collectorLabel}`).pipe(
        Command.lines,
        Effect.provideService(CommandExecutor.CommandExecutor, executor),
        Effect.map(stateFromPrint),
        Effect.mapError(
          (cause) =>
            new LaunchdError({
              step: "launchctl print",
              detail: String(cause),
            }),
        ),
      );
    const bootstrap = () =>
      exit("launchctl bootstrap", "bootstrap", domain, plistPath).pipe(
        Effect.flatMap((code) =>
          code === 0 || code === 5
            ? Effect.void
            : Effect.fail(
                new LaunchdError({
                  step: "launchctl bootstrap",
                  detail: `exit ${code}`,
                }),
              ),
        ),
      );
    const bootout = () =>
      exit("launchctl bootout", "bootout", `${domain}/${collectorLabel}`).pipe(
        Effect.flatMap((code) =>
          code === 0 || code === 3
            ? Effect.void
            : Effect.fail(
                new LaunchdError({
                  step: "launchctl bootout",
                  detail: `exit ${code}`,
                }),
              ),
        ),
      );
    return {
      isInstalled: () => fs.exists(plistPath).pipe(Effect.orDie),
      bootstrap,
      bootout,
      state,
      install: (plist: string) =>
        fs.makeDirectory(dirname(plistPath), { recursive: true }).pipe(
          Effect.andThen(
            fs.makeDirectory(dirname(logPath), { recursive: true }),
          ),
          Effect.andThen(fs.writeFileString(plistPath, plist)),
          Effect.mapError(
            (e) =>
              new LaunchdError({
                step: `write ${plistPath}`,
                detail: e.message,
              }),
          ),
          Effect.andThen(bootstrap()),
        ),
    };
  }),
  dependencies: [NodeContext.layer],
}) {
  // biome-ignore lint/style/useNamingConvention: layers are PascalCase
  static Test = Layer.unwrapEffect(
    Effect.map(
      Ref.make<LaunchdState>({
        installed: true,
        running: true,
        plist: null,
        installs: 0,
      }),
      fakeLaunchd,
    ),
  );
}
