import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { Command, CommandExecutor, FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Chunk, Data, Effect, Layer, Stream } from "effect";

export const appPath = join(homedir(), "Applications", "Clocktrace.app");
export const appMainPath = join(appPath, "Contents", "MacOS", "Clocktrace");
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

export class App extends Effect.Service<App>()("App", {
  effect: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const executor = yield* CommandExecutor.CommandExecutor;
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
    return {
      isInstalled: () => fs.exists(appMainPath).pipe(Effect.orDie),
      install: (helperPath: string) =>
        Effect.gen(function* () {
          // Build the whole bundle at a sibling first; an ad-hoc signature
          // embeds no path, so the staged bundle stays valid when it is
          // renamed over the live one, and a failure before the rename
          // leaves the old app untouched.
          const staging = `${appPath}.new`;
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
              return "copied" as const;
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
            return "written" as const;
          });
          // The live app moves aside first so a failed staging rename puts
          // it back; a landed rename keeps the rollback until the caller
          // commits or rolls it back.
          const result = yield* build.pipe(
            Effect.flatMap((r) =>
              fs.remove(rollback, { recursive: true, force: true }).pipe(
                Effect.mapError(fsError(`write ${rollback}`)),
                Effect.andThen(
                  fs.exists(appPath).pipe(
                    Effect.mapError(fsError(`rename ${appPath}`)),
                    Effect.flatMap((exists) =>
                      exists
                        ? fs
                            .rename(appPath, rollback)
                            .pipe(Effect.mapError(fsError(`rename ${appPath}`)))
                        : Effect.void,
                    ),
                  ),
                ),
                Effect.andThen(
                  fs.rename(staging, appPath).pipe(
                    Effect.mapError(fsError(`rename ${staging}`)),
                    Effect.tapError(() =>
                      Effect.ignore(fs.rename(rollback, appPath)),
                    ),
                  ),
                ),
                Effect.as(r),
              ),
            ),
            Effect.tapError(() =>
              Effect.ignore(
                fs.remove(staging, { recursive: true, force: true }),
              ),
            ),
          );
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
          return result;
        }),
      // install leaves .old behind so a caller that finds the new bundle
      // broken can put the previous app back; commit deletes it once the
      // new Collector is running.
      commit: () =>
        fs
          .remove(rollback, { recursive: true, force: true })
          .pipe(Effect.mapError(fsError(`write ${rollback}`))),
      // rename refuses to replace a non-empty directory, so the broken
      // bundle is removed first; a failed rename leaves .old in place.
      rollback: () =>
        Effect.gen(function* () {
          const has = yield* fs
            .exists(rollback)
            .pipe(Effect.mapError(fsError(`read ${rollback}`)));
          if (!has) {
            return;
          }
          yield* fs
            .remove(appPath, { recursive: true, force: true })
            .pipe(Effect.mapError(fsError(`remove ${appPath}`)));
          yield* fs
            .rename(rollback, appPath)
            .pipe(Effect.mapError(fsError(`rename ${rollback}`)));
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
        }).pipe(Effect.asVoid),
    };
  }),
  dependencies: [NodeContext.layer],
}) {
  // biome-ignore lint/style/useNamingConvention: layers are PascalCase
  static Test = Layer.succeed(
    this,
    new App({
      isInstalled: () => Effect.succeed(true),
      install: () => Effect.succeed("written" as const),
      commit: () => Effect.void,
      rollback: () => Effect.void,
    }),
  );
}
