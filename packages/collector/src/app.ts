import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { Command, CommandExecutor, FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Chunk, Data, Effect, Layer, Stream } from "effect";

export const appPath = join(homedir(), "Applications", "Clocktrace.app");
export const appMainPath = join(
  appPath,
  "Contents",
  "MacOS",
  "Clocktrace",
);
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
  codesignLines.some((l) =>
    l.startsWith("Authority=Developer ID Application"),
  );

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
          (e) =>
            new AppError({ step: "codesign -dv", detail: String(e) }),
        ),
      );
    const fsError =
      (step: string) =>
      (e: { readonly message: string }) =>
        new AppError({ step, detail: e.message });
    return {
      isInstalled: () => fs.exists(appMainPath).pipe(Effect.orDie),
      install: (helperPath: string) =>
        Effect.gen(function* () {
          const built = join(dirname(helperPath), "Clocktrace.app");
          yield* fs
            .remove(appPath, { recursive: true, force: true })
            .pipe(Effect.mapError(fsError(`write ${appPath}`)));
          const builtExists = yield* fs
            .exists(built)
            .pipe(Effect.mapError(fsError(`copy ${built}`)));
          let result: "copied" | "written";
          if (builtExists) {
            yield* fs
              .copy(built, appPath)
              .pipe(Effect.mapError(fsError(`copy ${appPath}`)));
            result = "copied";
          } else {
            yield* fs
              .makeDirectory(join(appPath, "Contents", "MacOS"), {
                recursive: true,
              })
              .pipe(Effect.mapError(fsError(`write ${appPath}`)));
            yield* fs
              .writeFileString(
                join(appPath, "Contents", "Info.plist"),
                infoPlist(),
              )
              .pipe(Effect.mapError(fsError(`write ${appPath}`)));
            yield* fs
              .copyFile(helperPath, appMainPath)
              .pipe(Effect.mapError(fsError(`copy ${appMainPath}`)));
            yield* fs
              .chmod(appMainPath, 0o755)
              .pipe(Effect.mapError(fsError(`write ${appMainPath}`)));
            const lines = yield* stderrLines(
              Command.make("codesign", "-dv", appMainPath),
            );
            if (!hasDeveloperIdSignature(lines)) {
              const code = yield* exit(
                "codesign",
                "codesign",
                "--force",
                "--sign",
                "-",
                appPath,
              );
              if (code !== 0) {
                return yield* new AppError({
                  step: "codesign",
                  detail: `exit ${code}`,
                });
              }
            }
            result = "written";
          }
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
    }),
  );
}
