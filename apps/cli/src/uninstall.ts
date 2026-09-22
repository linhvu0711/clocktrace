import { homedir } from "node:os";
import { dirname } from "node:path";

import {
  App,
  appBundleId,
  appPath as defaultAppPath,
  defaultDbPath,
  logDir as defaultLogDir,
  Launchd,
  plistEnv,
} from "@clocktrace/collector";
import { Command, Options } from "@effect/cli";
import {
  type CommandExecutor,
  FileSystem,
  type Path,
  Command as PlatformCommand,
  type Terminal,
} from "@effect/platform";
import { Config, Data, Effect, Either, Option } from "effect";

import { line, mark, Style, shellQuote, shortPath, span } from "./format.js";
import {
  type HostName,
  HostRemoveError,
  Hosts,
  hostNames,
  hostTitle,
  manualRemoveCommand,
} from "./hosts.js";
import { ReportedError, reportLaunchd, reportStep } from "./output.js";
import { Prompt, type Stdin, type StoppedError } from "./prompt.js";

export class PurgeError extends Data.TaggedError("PurgeError")<{
  readonly path: string;
  readonly detail: string;
}> {
  override get message(): string {
    return `remove ${this.path}: ${this.detail}`;
  }
}

// The database plus its SQLite side files. The folder goes too, but only
// when it is ours: a custom CLOCKTRACE_DB may sit in a folder the user
// keeps other things in.
export const purgeTargets = (
  dbPath: string,
  defaultPath: string = defaultDbPath,
): { readonly files: ReadonlyArray<string>; readonly dir: string | null } => ({
  files: [dbPath, `${dbPath}-wal`, `${dbPath}-shm`],
  dir: dbPath === defaultPath ? dirname(dbPath) : null,
});

export const uninstall = (options: {
  readonly purge: boolean;
  /** Test seams: the real paths are fixed at import from the home dir. */
  readonly logDir?: string;
  readonly appPath?: string;
}): Effect.Effect<
  void,
  ReportedError | StoppedError,
  | Prompt
  | Stdin
  | Launchd
  | App
  | Hosts
  | FileSystem.FileSystem
  | CommandExecutor.CommandExecutor
  | Terminal.Terminal
  | Path.Path
  | Style
> =>
  Effect.gen(function* () {
    const launchd = yield* Launchd;
    const app = yield* App;
    const hosts = yield* Hosts;
    const prompt = yield* Prompt;
    const fs = yield* FileSystem.FileSystem;
    const look = yield* Style;
    const home = homedir();
    const logDir = options.logDir ?? defaultLogDir;
    const appPath = options.appPath ?? defaultAppPath;
    const done = (text: string) =>
      prompt.print(line([mark("ok", look), ` ${text}`], look));
    const skipped = (text: string) =>
      prompt.print(line([mark("warn", look), ` ${text}`], look));
    const exists = (path: string) =>
      fs
        .exists(path)
        .pipe(
          Effect.mapError((e) => new PurgeError({ path, detail: e.message })),
        );
    const remove = (path: string) =>
      fs
        .remove(path, { recursive: true, force: true })
        .pipe(
          Effect.mapError((e) => new PurgeError({ path, detail: e.message })),
        );

    // setup bakes CLOCKTRACE_DB into the agent's plist, so a custom
    // database is found there even when the env var is not set now; an
    // env var set for this run still wins. Read it before the plist goes.
    const hadAgent = yield* launchd.isInstalled();
    const plist = hadAgent ? yield* reportLaunchd(launchd.readPlist()) : null;
    const envDb = yield* Effect.orDie(
      Config.option(Config.string("CLOCKTRACE_DB")),
    );
    const dbPath = Option.getOrElse(
      envDb,
      () =>
        (plist === null ? null : plistEnv(plist, "CLOCKTRACE_DB")) ??
        defaultDbPath,
    );
    yield* reportLaunchd(launchd.uninstall());
    yield* done(
      hadAgent ? "launch agent removed" : "launch agent already removed",
    );

    // Reset the grants while Launch Services still knows the bundle id:
    // tccutil refuses an id it cannot resolve, and after the bundle is
    // deleted it never can. Best effort beyond that: tccutil is not always
    // allowed to reset another bundle's grants; the user can drop them in
    // System Settings. Nothing to reset when the app is already gone; the
    // bundle folder is the guard, not the executable: a damaged bundle
    // still owns its grants.
    if (yield* reportStep(exists(appPath))) {
      const reset = yield* PlatformCommand.make(
        "tccutil",
        "reset",
        "All",
        appBundleId,
      ).pipe(
        PlatformCommand.exitCode,
        Effect.map((code) => code === 0),
        Effect.catchAll(() => Effect.succeed(false)),
      );
      if (reset) {
        yield* done("permissions reset");
      } else {
        yield* skipped(
          "permissions not reset · remove Clocktrace under System Settings › Privacy & Security",
        );
      }
    }

    const removed = yield* reportStep(app.remove());
    yield* done(removed === "removed" ? "app removed" : "app already removed");

    const detected = yield* hosts.detect();
    const found = hostNames.filter((h) => detected[h]);
    if (found.length === 0) {
      yield* skipped("no hosts found");
    }
    // A host that fails is reported and the rest still runs; the exit code
    // says so at the end.
    const failedHosts: Array<HostName> = [];
    for (const host of found) {
      const outcome = yield* Effect.either(hosts.unregister(host));
      if (Either.isLeft(outcome)) {
        failedHosts.push(host);
        yield* prompt.printError(
          line([mark("bad", look), ` ${outcome.left.message}`], look),
        );
      } else if (outcome.right === "no cli") {
        yield* skipped(
          `${hostTitle[host]}: ${host} not on PATH · run by hand: ${manualRemoveCommand[host]}`,
        );
      } else {
        yield* done(
          outcome.right === "not registered"
            ? `${hostTitle[host]} not registered`
            : `${hostTitle[host]} unregistered`,
        );
      }
    }

    let dbKept = true;
    if (options.purge) {
      // On a terminal the question is the consent; without one the flag is.
      const interactive = yield* prompt.interactive;
      const consent = interactive
        ? yield* prompt.confirm({
            message: `delete the database at ${shortPath(dbPath, home)}?`,
            initial: false,
          })
        : true;
      if (consent) {
        const hadDb = yield* reportStep(exists(dbPath));
        const { files, dir } = purgeTargets(dbPath);
        for (const file of files) {
          yield* reportStep(remove(file));
        }
        if (dir !== null) {
          yield* reportStep(remove(dir));
        }
        yield* done(hadDb ? "database removed" : "database already removed");
        dbKept = false;
      } else {
        yield* skipped("database kept");
      }
      const hadLogs = yield* reportStep(exists(logDir));
      yield* reportStep(remove(logDir));
      yield* done(hadLogs ? "logs removed" : "logs already removed");
    }

    // The plist that named a custom database is gone now, so the later
    // purge command carries the path itself.
    const purgeCommand =
      dbPath === defaultDbPath
        ? "clocktrace uninstall --purge"
        : `CLOCKTRACE_DB=${shellQuote(dbPath)} clocktrace uninstall --purge`;
    yield* prompt.print("");
    yield* prompt.print(
      dbKept
        ? line(
            [
              "Done. Database kept at ",
              span("dim", shortPath(dbPath, home)),
              " (",
              span("head", purgeCommand),
              " deletes it).",
            ],
            look,
          )
        : line(
            [
              "Done. Only the ",
              span("head", "clocktrace"),
              " command remains.",
            ],
            look,
          ),
    );
    const firstFailed = failedHosts[0];
    if (firstFailed !== undefined) {
      return yield* new ReportedError({
        cause: new HostRemoveError({ host: firstFailed }),
      });
    }
  });

const purgeOption = Options.boolean("purge").pipe(
  Options.withDescription("also delete the database and the logs"),
);

export const uninstallCommand = Command.make(
  "uninstall",
  { purge: purgeOption },
  ({ purge }) => uninstall({ purge }),
).pipe(
  Command.withDescription(
    "remove the collector, the app, and the host registrations",
  ),
);
