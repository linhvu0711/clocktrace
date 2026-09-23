import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Exit, Layer, Ref } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NotSetUpError, requireInstalled } from "../src/installed.js";
import { fakeLaunchd, type LaunchdState } from "../src/launchd.js";

const launchdIn = (state: LaunchdState) =>
  Layer.unwrapEffect(Effect.map(Ref.make<LaunchdState>(state), fakeLaunchd));

const check = (path: string, state: LaunchdState) =>
  Effect.runPromise(
    Effect.exit(
      requireInstalled(path).pipe(
        Effect.provide(Layer.mergeAll(launchdIn(state), NodeFileSystem.layer)),
      ),
    ),
  );

describe("requireInstalled", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clocktrace-"));
    path = join(dir, "clocktrace.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("plist missing, database present fails not set up", async () => {
    // Given: the database file, no plist
    writeFileSync(path, "");
    // When
    const exit = await check(path, {
      installed: false,
      running: false,
      plist: null,
      installs: 0,
    });
    // Then
    expect(exit).toEqual(Exit.fail(new NotSetUpError({ dbPath: path })));
    if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
      expect(exit.cause.error.message).toBe(
        `not set up, run clocktrace setup · looked for ${path}`,
      );
    }
  });

  it("database missing fails not set up", async () => {
    // Given: the plist, no database file
    // When
    const exit = await check(path, {
      installed: true,
      running: true,
      plist: null,
      installs: 0,
    });
    // Then
    expect(exit).toEqual(Exit.fail(new NotSetUpError({ dbPath: path })));
  });

  it("installed but stopped with the database passes", async () => {
    // Given: the plist, the database file, the Collector stopped
    writeFileSync(path, "");
    // When
    const exit = await check(path, {
      installed: true,
      running: false,
      plist: null,
      installs: 0,
    });
    // Then
    expect(exit).toEqual(Exit.void);
  });
});
