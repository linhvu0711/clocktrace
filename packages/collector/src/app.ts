import { dirname, join } from "node:path";

import { Command, CommandExecutor, FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Chunk, Data, Effect, Layer, Stream } from "effect";

import { CollectorPaths } from "./paths.js";

export const appBundleId = "com.clocktrace.app";
export const lsregisterPath =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

export const infoPlist = (): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.clocktrace.app</string>
  <key>CFBundleName</key>
  <string>Clocktrace</string>
  <key>CFBundleExecutable</key>
  <string>Clocktrace</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSAppleEventsUsageDescription</key>
  <string>Clocktrace reads the URL of the page in front in your browser.</string>
</dict>
</plist>
`;

export const hasDeveloperIdSignature = (
  codesignLines: ReadonlyArray<string>,
): boolean =>
  codesignLines.some((l) => l.startsWith("Authority=Developer ID Application"));

// What an install did to the live App: wrote the first one, or moved an
// old one to .old and replaced it.
export type AppInstall = "fresh" | "replaced";

export class AppError extends Data.TaggedError("AppError")<{
  readonly step: string;
  readonly detail: string;
}> {
  override get message(): string {
    return `${this.step}: ${this.detail}`;
  }
}

export class AppMissingError extends Data.TaggedError("AppMissingError")<{
  readonly path: string;
}> {
  override get message(): string {
    return `app: missing, run clocktrace setup`;
  }
}

// App.install failed after the live App moved. The change was undone
// first; `appRestored` is false when it could not be.
export class AppNotInstalledError extends Data.TaggedError(
  "AppNotInstalledError",
)<{
  readonly cause: AppError;
  readonly appRestored: boolean;
}> {
  override get message(): string {
    return this.cause.message;
  }
}

export class App extends Effect.Service<App>()("App", {
  effect: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const executor = yield* CommandExecutor.CommandExecutor;
    const { appPath, appMainPath } = yield* CollectorPaths;
    const exit = (
      step: string,
      command: string,
      ...args: ReadonlyArray<string>
    ) =>
      Command.make(command, ...args).pipe(
        Command.exitCode,
        Effect.provideService(CommandExecutor.CommandExecutor, executor),
        Effect.mapError(
          (cause) => new AppError({ step, detail: String(cause) }),
        ),
      );
    // codesign writes its display to stderr and nothing to stdout, and
    // exits 1 on an unsigned file; read the stderr text and ignore the
    // exit code here.
    const stderrLines = (command: Command.Command) =>
      Effect.scoped(
        Effect.flatMap(executor.start(command), (p) =>
          p.stderr.pipe(
            Stream.decodeText(),
            Stream.splitLines,
            Stream.runCollect,
            Effect.map(Chunk.toReadonlyArray),
          ),
        ),
      ).pipe(
        Effect.mapError(
          (e) => new AppError({ step: "codesign -dv", detail: String(e) }),
        ),
      );
    const fsError = (step: string) => (e: { readonly message: string }) =>
      new AppError({ step, detail: e.message });
    const rollback = `${appPath}.old`;
    const staging = `${appPath}.new`;
    // Moves .old back over the live bundle; a no-op without .old. rename
    // refuses to replace a non-empty directory, so the live bundle moves
    // aside first and a failed .old rename puts it back.
    const putBack: Effect.Effect<void, AppError> = Effect.gen(function* () {
      const has = yield* fs
        .exists(rollback)
        .pipe(Effect.mapError(fsError(`read ${rollback}`)));
      if (!has) {
        return;
      }
      const aside = `${appPath}.reverting`;
      yield* fs
        .remove(aside, { recursive: true, force: true })
        .pipe(Effect.mapError(fsError(`write ${aside}`)));
      const live = yield* fs
        .exists(appPath)
        .pipe(Effect.mapError(fsError(`read ${appPath}`)));
      if (live) {
        yield* fs
          .rename(appPath, aside)
          .pipe(Effect.mapError(fsError(`rename ${appPath}`)));
      }
      yield* fs.rename(rollback, appPath).pipe(
        Effect.mapError(fsError(`rename ${rollback}`)),
        Effect.tapError(() => Effect.ignore(fs.rename(aside, appPath))),
      );
      yield* fs
        .remove(aside, { recursive: true, force: true })
        .pipe(Effect.mapError(fsError(`write ${aside}`)));
      const registered = yield* exit(
        "lsregister",
        lsregisterPath,
        "-f",
        appPath,
      );
      if (registered !== 0) {
        return yield* new AppError({
          step: "lsregister",
          detail: `exit ${registered}`,
        });
      }
    }).pipe(Effect.asVoid);
    // Unregister with Launch Services before the bundle goes, so the
    // grants the app owned do not point at a missing path; a failed
    // unregister is ignored, the bundle is removed either way. The .old
    // and .new siblings an interrupted install leaves go too.
    const removeBundle: Effect.Effect<"removed" | "absent", AppError> =
      Effect.gen(function* () {
        const present = yield* fs
          .exists(appPath)
          .pipe(Effect.mapError(fsError(`read ${appPath}`)));
        if (present) {
          yield* Effect.ignore(
            exit("lsregister", lsregisterPath, "-u", appPath),
          );
          yield* fs
            .remove(appPath, { recursive: true, force: true })
            .pipe(Effect.mapError(fsError(`remove ${appPath}`)));
        }
        for (const sibling of [rollback, staging]) {
          yield* fs
            .remove(sibling, { recursive: true, force: true })
            .pipe(Effect.mapError(fsError(`remove ${sibling}`)));
        }
        return present ? "removed" : "absent";
      });
    // Undoes what install did: a replaced App comes back from .old; a
    // fresh one is removed, with its .old and .new siblings.
    const undo = (installed: AppInstall): Effect.Effect<void, AppError> =>
      installed === "replaced" ? putBack : Effect.asVoid(removeBundle);
    return {
      isInstalled: () => fs.exists(appMainPath).pipe(Effect.orDie),
      install: (helperPath: string) =>
        Effect.gen(function* () {
          // Build the whole bundle at a sibling first; an ad-hoc signature
          // embeds no path, so the staged bundle stays valid when it is
          // renamed over the live one, and a failure before the rename
          // leaves the old app untouched.
          const stagingMain = join(staging, "Contents", "MacOS", "Clocktrace");
          const built = join(dirname(helperPath), "Clocktrace.app");
          const build = Effect.gen(function* () {
            yield* fs
              .remove(staging, { recursive: true, force: true })
              .pipe(Effect.mapError(fsError(`write ${staging}`)));
            const builtExists = yield* fs
              .exists(built)
              .pipe(Effect.mapError(fsError(`copy ${built}`)));
            if (builtExists) {
              yield* fs
                .copy(built, staging)
                .pipe(Effect.mapError(fsError(`copy ${staging}`)));
              return;
            }
            yield* fs
              .makeDirectory(join(staging, "Contents", "MacOS"), {
                recursive: true,
              })
              .pipe(Effect.mapError(fsError(`write ${staging}`)));
            yield* fs
              .writeFileString(
                join(staging, "Contents", "Info.plist"),
                infoPlist(),
              )
              .pipe(Effect.mapError(fsError(`write ${staging}`)));
            yield* fs
              .copyFile(helperPath, stagingMain)
              .pipe(Effect.mapError(fsError(`copy ${stagingMain}`)));
            yield* fs
              .chmod(stagingMain, 0o755)
              .pipe(Effect.mapError(fsError(`write ${stagingMain}`)));
            const lines = yield* stderrLines(
              Command.make("codesign", "-dv", stagingMain),
            );
            if (!hasDeveloperIdSignature(lines)) {
              const code = yield* exit(
                "codesign",
                "codesign",
                "--force",
                "--sign",
                "-",
                staging,
              );
              if (code !== 0) {
                return yield* new AppError({
                  step: "codesign",
                  detail: `exit ${code}`,
                });
              }
            }
          });
          // The live app moves aside first so a failed staging rename puts
          // it back and says whether it could; a landed rename keeps the
          // rollback until the caller commits or rolls it back.
          const result: AppInstall = yield* build.pipe(
            Effect.andThen(
              fs.remove(rollback, { recursive: true, force: true }).pipe(
                Effect.mapError(fsError(`write ${rollback}`)),
                Effect.andThen(
                  fs.exists(appPath).pipe(
                    Effect.mapError(fsError(`rename ${appPath}`)),
                    Effect.flatMap((exists) =>
                      exists
                        ? fs
                            .rename(appPath, rollback)
                            .pipe(
                              Effect.mapError(fsError(`rename ${appPath}`)),
                              Effect.as("replaced" as const),
                            )
                        : Effect.succeed("fresh" as const),
                    ),
                  ),
                ),
                Effect.tap((installed) =>
                  fs.rename(staging, appPath).pipe(
                    Effect.mapError(fsError(`rename ${staging}`)),
                    Effect.catchAll((cause) =>
                      (installed === "replaced"
                        ? fs.rename(rollback, appPath).pipe(
                            Effect.as(true),
                            Effect.catchAll(() => Effect.succeed(false)),
                          )
                        : Effect.succeed(true)
                      ).pipe(
                        Effect.flatMap(
                          (appRestored) =>
                            new AppNotInstalledError({ cause, appRestored }),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            Effect.tapError(() =>
              Effect.ignore(
                fs.remove(staging, { recursive: true, force: true }),
              ),
            ),
          );
          const register = exit(
            "lsregister",
            lsregisterPath,
            "-f",
            appPath,
          ).pipe(
            Effect.flatMap((code) =>
              code === 0
                ? Effect.void
                : new AppError({ step: "lsregister", detail: `exit ${code}` }),
            ),
          );
          // The swap already landed; undo it, so a replaced app comes back
          // and a fresh one goes, and install never returns with an
          // unresolved rollback. `appRestored` says whether the undo held.
          yield* register.pipe(
            Effect.catchAll((cause) =>
              undo(result).pipe(
                Effect.as(true),
                Effect.catchAll(() => Effect.succeed(false)),
                Effect.flatMap(
                  (appRestored) =>
                    new AppNotInstalledError({ cause, appRestored }),
                ),
              ),
            ),
          );
          return result;
        }),
      // install leaves .old behind so a caller that finds the new bundle
      // broken can undo it: rollback takes install's result, putting the
      // previous app back or removing a fresh one; commit deletes .old
      // once the new Collector is running.
      commit: () =>
        fs
          .remove(rollback, { recursive: true, force: true })
          .pipe(Effect.mapError(fsError(`write ${rollback}`))),
      rollback: undo,
      remove: () => removeBundle,
    };
  }),
  dependencies: [NodeContext.layer],
}) {
  // biome-ignore lint/style/useNamingConvention: layers are PascalCase
  static Test = Layer.succeed(
    this,
    new App({
      isInstalled: () => Effect.succeed(true),
      install: () => Effect.succeed("replaced" as const),
      commit: () => Effect.void,
      rollback: () => Effect.void,
      remove: () => Effect.succeed("removed" as const),
    }),
  );
}
