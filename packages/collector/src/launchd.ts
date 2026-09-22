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
  options?: {
    readonly failBootstrap?: boolean;
    readonly bootstrapStuck?: boolean;
    readonly stalledSamples?: number;
  },
): Layer.Layer<Launchd> => {
  const failed = () =>
    Effect.fail(
      new LaunchdError({ step: "launchctl bootstrap", detail: "exit 1" }),
    );
  let samples = 0;
  return Layer.succeed(
    Launchd,
    new Launchd({
      isInstalled: () => Ref.get(state).pipe(Effect.map((s) => s.installed)),
      install: (plist) =>
        options?.failBootstrap
          ? failed()
          : Ref.update(state, (s) => ({
              installed: true,
              running: !options?.bootstrapStuck,
              plist,
              installs: s.installs + 1,
            })),
      bootstrap: () =>
        options?.failBootstrap
          ? failed()
          : options?.bootstrapStuck
            ? Effect.void
            : Ref.update(state, (s) => ({ ...s, running: true })),
      bootout: () => Ref.update(state, (s) => ({ ...s, running: false })),
      uninstall: () =>
        Ref.update(state, (s) => ({
          ...s,
          installed: false,
          running: false,
          plist: null,
        })),
      state: () => {
        const stalled = options?.stalledSamples;
        if (stalled !== undefined) {
          return Effect.sync(() => {
            samples += 1;
            return samples > stalled
              ? ("running" as const)
              : ("stopped" as const);
          });
        }
        return Ref.get(state).pipe(
          Effect.map((s) => (s.running ? "running" : "stopped")),
        );
      },
    }),
  );
};

export class LaunchdError extends Data.TaggedError("LaunchdError")<{
  readonly step: string;
  readonly detail: string;
}> {
  override get message(): string {
    const base = `${this.step}: ${this.detail}`;
    // Only launchctl failures land in the collector log; a plist write or
    // remove failure happens before the Collector runs, so its cause is in
    // the step and detail, not the log.
    return this.step.startsWith("launchctl")
      ? `${base} · see ${logPath}`
      : base;
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
      // Remove the plist only after the job is unloaded. bootout already
      // treats an absent job (exit 3) as success; any other unload failure
      // keeps the plist so a still-loaded job is not orphaned.
      uninstall: () =>
        bootout().pipe(
          Effect.andThen(
            fs.remove(plistPath, { force: true }).pipe(
              Effect.mapError(
                (e) =>
                  new LaunchdError({
                    step: `remove ${plistPath}`,
                    detail: e.message,
                  }),
              ),
            ),
          ),
        ),
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
          Effect.andThen(
            bootstrap().pipe(
              Effect.tapError(() =>
                fs.remove(plistPath, { force: true }).pipe(Effect.ignore),
              ),
            ),
          ),
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
