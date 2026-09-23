import { Store, StoreError } from "@clocktrace/core";
import {
  DateTime,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Logger,
  Option,
  Stream,
} from "effect";
import { describe, expect, it } from "vitest";

import { collect } from "../src/collector.js";

const line = (o: Record<string, unknown>): string =>
  JSON.stringify({
    app: null,
    bundleId: null,
    title: null,
    url: null,
    idleSeconds: 0,
    missing: [],
    ...o,
  });

const run = (lines: ReadonlyArray<string>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* Store;
      const device = yield* store.upsertDevice({
        kind: "mac",
        name: "Studio",
        externalId: "mac-1",
      });
      yield* collect(Stream.fromIterable(lines), device.id);
      const rows = yield* store.readActivities({
        from: DateTime.unsafeMake("2026-01-01T00:00:00Z"),
        to: DateTime.unsafeMake("2026-01-02T00:00:00Z"),
      });
      return rows.map((a) => ({
        appName: a.appName,
        title: a.title,
        url: a.url,
        startedAt: DateTime.formatIso(a.startedAt),
        endedAt: DateTime.formatIso(a.endedAt),
      }));
    }).pipe(Effect.provide(Store.Test)),
  );

describe("collector", () => {
  it("two apps give two rows whose spans match the switches", async () => {
    // Given: focus moves Safari -> TextEdit
    const lines = [
      line({
        ts: "2026-01-01T00:00:00.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
        title: "Example Domain",
        url: "https://example.com/",
      }),
      line({
        ts: "2026-01-01T00:00:05.000Z",
        app: "TextEdit",
        bundleId: "com.apple.TextEdit",
        title: "Untitled",
      }),
      line({
        ts: "2026-01-01T00:00:12.000Z",
        app: "TextEdit",
        bundleId: "com.apple.TextEdit",
        title: "Untitled",
      }),
    ];
    // When
    const rows = await run(lines);
    // Then
    expect(rows).toEqual([
      {
        appName: "Safari",
        title: "Example Domain",
        url: "https://example.com/",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T00:00:05.000Z",
      },
      {
        appName: "TextEdit",
        title: "Untitled",
        url: null,
        startedAt: "2026-01-01T00:00:05.000Z",
        endedAt: "2026-01-01T00:00:12.000Z",
      },
    ]);
  });

  it("an app-name change alone closes and reopens the Activity", async () => {
    // Given: the front app renames under the same bundle
    const lines = [
      line({
        ts: "2026-01-01T00:00:00.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
      }),
      line({
        ts: "2026-01-01T00:00:05.000Z",
        app: "Safari 2",
        bundleId: "com.apple.Safari",
      }),
      line({
        ts: "2026-01-01T00:00:12.000Z",
        app: "Safari 2",
        bundleId: "com.apple.Safari",
      }),
    ];
    // When
    const rows = await run(lines);
    // Then
    expect(rows).toEqual([
      {
        appName: "Safari",
        title: null,
        url: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T00:00:05.000Z",
      },
      {
        appName: "Safari 2",
        title: null,
        url: null,
        startedAt: "2026-01-01T00:00:05.000Z",
        endedAt: "2026-01-01T00:00:12.000Z",
      },
    ]);
  });

  it("a title under a missing Accessibility grant is written null", async () => {
    // Given: the helper reports accessibility missing; title stays null
    const lines = [
      line({
        ts: "2026-01-01T00:00:00.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
        url: "https://example.com/",
        missing: ["accessibility"],
      }),
      line({
        ts: "2026-01-01T00:00:10.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
        url: "https://example.com/",
        missing: ["accessibility"],
      }),
    ];
    // When
    const rows = await run(lines);
    // Then
    expect(rows).toEqual([
      {
        appName: "Safari",
        title: null,
        url: "https://example.com/",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T00:00:10.000Z",
      },
    ]);
  });

  it("an interrupt closes the open Activity at the last line", async () => {
    // Given: a stream that emits two lines then never ends
    const lines = [
      line({
        ts: "2026-01-01T00:00:00.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
      }),
      line({
        ts: "2026-01-01T00:00:10.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
      }),
    ];
    // When
    const rows = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        const device = yield* store.upsertDevice({
          kind: "mac",
          name: "Studio",
          externalId: "mac-1",
        });
        const reached = yield* Deferred.make<void>();
        const stream = Stream.fromIterable(lines).pipe(
          Stream.concat(
            Stream.fromEffect(Deferred.succeed(reached, undefined)).pipe(
              Stream.drain,
            ),
          ),
          Stream.concat(Stream.never),
        );
        const fiber = yield* Effect.fork(collect(stream, device.id));
        yield* Deferred.await(reached);
        yield* Fiber.interrupt(fiber);
        const result = yield* store.readActivities({
          from: DateTime.unsafeMake("2026-01-01T00:00:00Z"),
          to: DateTime.unsafeMake("2026-01-02T00:00:00Z"),
        });
        return result.map((a) => ({
          appName: a.appName,
          title: a.title,
          url: a.url,
          startedAt: DateTime.formatIso(a.startedAt),
          endedAt: DateTime.formatIso(a.endedAt),
        }));
      }).pipe(Effect.provide(Store.Test)),
    );
    // Then
    expect(rows).toEqual([
      {
        appName: "Safari",
        title: null,
        url: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T00:00:10.000Z",
      },
    ]);
  });

  it("a line with no app closes the open Activity and opens none", async () => {
    // Given: focus drops to the login window, then returns
    const lines = [
      line({
        ts: "2026-01-01T00:00:00.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
      }),
      line({ ts: "2026-01-01T00:00:05.000Z" }),
      line({
        ts: "2026-01-01T00:00:20.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
      }),
      line({
        ts: "2026-01-01T00:00:25.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
      }),
    ];
    // When
    const rows = await run(lines);
    // Then
    expect(rows).toEqual([
      {
        appName: "Safari",
        title: null,
        url: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T00:00:05.000Z",
      },
      {
        appName: "Safari",
        title: null,
        url: null,
        startedAt: "2026-01-01T00:00:20.000Z",
        endedAt: "2026-01-01T00:00:25.000Z",
      },
    ]);
  });

  it("a line with an app name but no bundle id writes a Stand-in id", async () => {
    // Given: a Wine game with no bundle id, then Safari
    const lines = [
      line({ ts: "2026-01-01T00:00:00.000Z", app: "QSanguosha.exe" }),
      line({
        ts: "2026-01-01T00:00:05.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
      }),
    ];
    // When
    const rows = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        const device = yield* store.upsertDevice({
          kind: "mac",
          name: "Studio",
          externalId: "mac-1",
        });
        yield* collect(Stream.fromIterable(lines), device.id);
        const activities = yield* store.readActivities({
          from: DateTime.unsafeMake("2026-01-01T00:00:00Z"),
          to: DateTime.unsafeMake("2026-01-02T00:00:00Z"),
        });
        return activities.map((a) => ({
          bundleId: a.bundleId,
          appName: a.appName,
        }));
      }).pipe(Effect.provide(Store.Test)),
    );
    // Then
    expect(rows[0]).toEqual({
      bundleId: "noid:QSanguosha.exe",
      appName: "QSanguosha.exe",
    });
  });

  it("a blank app name with no bundle id opens no Activity", async () => {
    // Given: focus goes to an app with a blank name, then an empty one
    const lines = [
      line({
        ts: "2026-01-01T00:00:00.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
      }),
      line({ ts: "2026-01-01T00:00:05.000Z", app: "  " }),
      line({ ts: "2026-01-01T00:00:10.000Z", app: "" }),
      line({
        ts: "2026-01-01T00:00:20.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
      }),
      line({
        ts: "2026-01-01T00:00:25.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
      }),
    ];
    // When
    const rows = await run(lines);
    // Then
    expect(rows).toEqual([
      {
        appName: "Safari",
        title: null,
        url: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T00:00:05.000Z",
      },
      {
        appName: "Safari",
        title: null,
        url: null,
        startedAt: "2026-01-01T00:00:20.000Z",
        endedAt: "2026-01-01T00:00:25.000Z",
      },
    ]);
  });

  it("idle ends the open Activity at now minus idleSeconds and the return starts a fresh one at the return time", async () => {
    // Given: five idle minutes pass inside a Safari stretch
    const lines = [
      line({
        ts: "2026-01-01T00:00:00.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
      }),
      line({
        ts: "2026-01-01T00:01:00.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
      }),
      line({
        ts: "2026-01-01T00:06:10.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
        idleSeconds: 310,
      }),
      line({
        ts: "2026-01-01T00:06:20.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
        idleSeconds: 2,
      }),
      line({
        ts: "2026-01-01T00:06:30.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
      }),
    ];
    // When
    const rows = await run(lines);
    // Then
    expect(rows).toEqual([
      {
        appName: "Safari",
        title: null,
        url: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T00:01:00.000Z",
      },
      {
        appName: "Safari",
        title: null,
        url: null,
        startedAt: "2026-01-01T00:06:18.000Z",
        endedAt: "2026-01-01T00:06:30.000Z",
      },
    ]);
  });

  it("a no-app line after an idle close stops the resume backdate", async () => {
    // Given: idle closes Safari, a login-window line intervenes, Safari returns
    const lines = [
      line({
        ts: "2026-01-01T00:00:00.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
      }),
      line({
        ts: "2026-01-01T00:00:10.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
      }),
      line({
        ts: "2026-01-01T00:05:15.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
        idleSeconds: 305,
      }),
      line({ ts: "2026-01-01T00:05:20.000Z" }),
      line({
        ts: "2026-01-01T00:05:30.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
        idleSeconds: 5,
      }),
      line({
        ts: "2026-01-01T00:05:40.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
      }),
    ];
    // When
    const rows = await run(lines);
    // Then: the resumed span starts at the line, not backdated over the gap
    expect(rows).toEqual([
      {
        appName: "Safari",
        title: null,
        url: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T00:00:10.000Z",
      },
      {
        appName: "Safari",
        title: null,
        url: null,
        startedAt: "2026-01-01T00:05:30.000Z",
        endedAt: "2026-01-01T00:05:40.000Z",
      },
    ]);
  });

  it("idle with no open Activity writes nothing", async () => {
    // Given: idle resolves before any focus line
    const lines = [
      line({
        ts: "2026-01-01T00:06:10.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
        idleSeconds: 310,
      }),
      line({
        ts: "2026-01-01T00:06:20.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
        idleSeconds: 2,
      }),
      line({
        ts: "2026-01-01T00:06:30.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
      }),
    ];
    // When
    const rows = await run(lines);
    // Then
    expect(rows).toEqual([
      {
        appName: "Safari",
        title: null,
        url: null,
        startedAt: "2026-01-01T00:06:20.000Z",
        endedAt: "2026-01-01T00:06:30.000Z",
      },
    ]);
  });

  it("a Private rule blanks title and url before the write", async () => {
    // Given: the Starter set's `(Incognito)` rule is Private
    const lines = [
      line({
        ts: "2026-01-01T00:00:00.000Z",
        app: "Google Chrome",
        bundleId: "com.google.Chrome",
        title: "Example Domain - Google Chrome (Incognito)",
        url: "https://example.com/",
      }),
      line({
        ts: "2026-01-01T00:00:10.000Z",
        app: "Google Chrome",
        bundleId: "com.google.Chrome",
        title: "Example Domain - Google Chrome (Incognito)",
        url: "https://example.com/",
      }),
    ];
    // When
    const rows = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        const device = yield* store.upsertDevice({
          kind: "mac",
          name: "Studio",
          externalId: "mac-1",
        });
        yield* collect(Stream.fromIterable(lines), device.id);
        const result = yield* store.readActivities({
          from: DateTime.unsafeMake("2026-01-01T00:00:00Z"),
          to: DateTime.unsafeMake("2026-01-02T00:00:00Z"),
        });
        return result.map((a) => ({
          appName: a.appName,
          bundleId: a.bundleId,
          title: a.title,
          url: a.url,
          startedAt: DateTime.formatIso(a.startedAt),
          endedAt: DateTime.formatIso(a.endedAt),
        }));
      }).pipe(Effect.provide(Store.Test)),
    );
    // Then
    expect(rows).toEqual([
      {
        appName: "Google Chrome",
        bundleId: "com.google.Chrome",
        title: null,
        url: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T00:00:10.000Z",
      },
    ]);
  });

  it("blanks a Brave private window title", async () => {
    // Given: the Starter set's `(Private)` rule matches Brave's private suffix
    const lines = [
      line({
        ts: "2026-01-01T00:00:00.000Z",
        app: "Brave Browser",
        bundleId: "com.brave.Browser",
        title: "Example - Brave (Private)",
        url: "https://example.com/",
      }),
      line({
        ts: "2026-01-01T00:00:10.000Z",
        app: "Brave Browser",
        bundleId: "com.brave.Browser",
        title: "Example - Brave (Private)",
        url: "https://example.com/",
      }),
    ];
    // When
    const rows = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        const device = yield* store.upsertDevice({
          kind: "mac",
          name: "Studio",
          externalId: "mac-1",
        });
        yield* collect(Stream.fromIterable(lines), device.id);
        const result = yield* store.readActivities({
          from: DateTime.unsafeMake("2026-01-01T00:00:00Z"),
          to: DateTime.unsafeMake("2026-01-02T00:00:00Z"),
        });
        return result.map((a) => ({
          appName: a.appName,
          bundleId: a.bundleId,
          title: a.title,
          url: a.url,
          startedAt: DateTime.formatIso(a.startedAt),
          endedAt: DateTime.formatIso(a.endedAt),
        }));
      }).pipe(Effect.provide(Store.Test)),
    );
    // Then
    expect(rows).toEqual([
      {
        appName: "Brave Browser",
        bundleId: "com.brave.Browser",
        title: null,
        url: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T00:00:10.000Z",
      },
    ]);
  });

  it("an Activity under 1 second is dropped", async () => {
    // Given: a 400ms TextEdit blip inside a Safari stretch
    const lines = [
      line({
        ts: "2026-01-01T00:00:00.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
      }),
      line({
        ts: "2026-01-01T00:00:05.000Z",
        app: "TextEdit",
        bundleId: "com.apple.TextEdit",
      }),
      line({
        ts: "2026-01-01T00:00:05.400Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
      }),
      line({
        ts: "2026-01-01T00:00:10.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
      }),
    ];
    // When
    const rows = await run(lines);
    // Then
    expect(rows).toEqual([
      {
        appName: "Safari",
        title: null,
        url: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T00:00:05.000Z",
      },
      {
        appName: "Safari",
        title: null,
        url: null,
        startedAt: "2026-01-01T00:00:05.400Z",
        endedAt: "2026-01-01T00:00:10.000Z",
      },
    ]);
  });

  it("an idle end before the start writes nothing", async () => {
    // Given: the only line after the open reports 320 idle seconds
    const lines = [
      line({
        ts: "2026-01-01T00:00:00.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
      }),
      line({
        ts: "2026-01-01T00:00:10.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
        idleSeconds: 320,
      }),
    ];
    // When
    const rows = await run(lines);
    // Then
    expect(rows).toEqual([]);
  });

  it("a line that is not a helper line is skipped", async () => {
    // Given: one undecodable line between two heartbeats
    const lines = [
      line({
        ts: "2026-01-01T00:00:00.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
      }),
      "not json",
      line({
        ts: "2026-01-01T00:00:10.000Z",
        app: "Safari",
        bundleId: "com.apple.Safari",
      }),
    ];
    // When
    const rows = await run(lines);
    // Then
    expect(rows).toEqual([
      {
        appName: "Safari",
        title: null,
        url: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T00:00:10.000Z",
      },
    ]);
  });

  it("a browser line saves its Grant", async () => {
    // Given: a Chrome line carrying a denied Grant, then a Finder line
    const lines = [
      line({
        ts: "2026-01-01T09:00:00Z",
        app: "Google Chrome",
        bundleId: "com.google.Chrome",
        grant: "denied",
      }),
      line({
        ts: "2026-01-01T09:00:05Z",
        app: "Finder",
        bundleId: "com.apple.finder",
      }),
    ];
    // When
    const saved = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        const device = yield* store.upsertDevice({
          kind: "mac",
          name: "Studio",
          externalId: "mac-1",
        });
        yield* collect(Stream.fromIterable(lines), device.id);
        return yield* store.getSetting("grant.com.google.Chrome");
      }).pipe(Effect.provide(Store.Test)),
    );
    // Then
    expect(saved).toEqual(
      Option.some('{"state":"denied","checkedAt":"2026-01-01T09:00:00.000Z"}'),
    );
  });

  it("identical Grant lines within 60 s write once", async () => {
    // Given: two Chrome lines with the same Grant ten seconds apart
    const lines = [
      line({
        ts: "2026-01-01T09:00:00Z",
        app: "Google Chrome",
        bundleId: "com.google.Chrome",
        grant: "denied",
      }),
      line({
        ts: "2026-01-01T09:00:10Z",
        app: "Google Chrome",
        bundleId: "com.google.Chrome",
        grant: "denied",
      }),
      line({
        ts: "2026-01-01T09:00:15Z",
        app: "Finder",
        bundleId: "com.apple.finder",
      }),
    ];
    // When
    const saved = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        const device = yield* store.upsertDevice({
          kind: "mac",
          name: "Studio",
          externalId: "mac-1",
        });
        yield* collect(Stream.fromIterable(lines), device.id);
        return yield* store.getSetting("grant.com.google.Chrome");
      }).pipe(Effect.provide(Store.Test)),
    );
    // Then
    expect(saved).toEqual(
      Option.some('{"state":"denied","checkedAt":"2026-01-01T09:00:00.000Z"}'),
    );
  });

  it("an unchanged Grant is written again after 60 s", async () => {
    // Given: three granted Chrome lines at t0, t0 + 30 s, t0 + 61 s
    const lines = [
      line({
        ts: "2026-01-01T09:00:00Z",
        app: "Google Chrome",
        bundleId: "com.google.Chrome",
        grant: "granted",
      }),
      line({
        ts: "2026-01-01T09:00:30Z",
        app: "Google Chrome",
        bundleId: "com.google.Chrome",
        grant: "granted",
      }),
      line({
        ts: "2026-01-01T09:01:01Z",
        app: "Google Chrome",
        bundleId: "com.google.Chrome",
        grant: "granted",
      }),
    ];
    let writes = 0;
    const countSetSetting = Layer.effect(
      Store,
      Effect.map(
        Store,
        (s) =>
          new Store({
            ...s,
            setSetting: (key, value) => {
              writes += 1;
              return s.setSetting(key, value);
            },
          }),
      ),
    );
    // When
    const saved = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        const device = yield* store.upsertDevice({
          kind: "mac",
          name: "Studio",
          externalId: "mac-1",
        });
        yield* collect(Stream.fromIterable(lines), device.id);
        return yield* store.getSetting("grant.com.google.Chrome");
      }).pipe(Effect.provide(Layer.provide(countSetSetting, Store.Test))),
    );
    // Then: written at t0 and again at t0 + 61 s, not at t0 + 30 s
    expect(writes).toBe(2);
    expect(saved).toEqual(
      Option.some('{"state":"granted","checkedAt":"2026-01-01T09:01:01.000Z"}'),
    );
  });

  it("a backward clock writes an unchanged Grant again", async () => {
    // Given: two granted Chrome lines, the second before the first in wall time
    const lines = [
      line({
        ts: "2026-01-01T09:00:00Z",
        app: "Google Chrome",
        bundleId: "com.google.Chrome",
        grant: "granted",
      }),
      line({
        ts: "2026-01-01T08:59:30Z",
        app: "Google Chrome",
        bundleId: "com.google.Chrome",
        grant: "granted",
      }),
    ];
    let writes = 0;
    const countSetSetting = Layer.effect(
      Store,
      Effect.map(
        Store,
        (s) =>
          new Store({
            ...s,
            setSetting: (key, value) => {
              writes += 1;
              return s.setSetting(key, value);
            },
          }),
      ),
    );
    // When
    const saved = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        const device = yield* store.upsertDevice({
          kind: "mac",
          name: "Studio",
          externalId: "mac-1",
        });
        yield* collect(Stream.fromIterable(lines), device.id);
        return yield* store.getSetting("grant.com.google.Chrome");
      }).pipe(Effect.provide(Layer.provide(countSetSetting, Store.Test))),
    );
    // Then: the backward line writes again with the earlier checkedAt
    expect(writes).toBe(2);
    expect(saved).toEqual(
      Option.some('{"state":"granted","checkedAt":"2026-01-01T08:59:30.000Z"}'),
    );
  });

  it("a Grant that returns to notAsked is saved again on the next answer", async () => {
    // Given: Chrome denied, then a reset gives notAsked, then denied again
    const lines = [
      line({
        ts: "2026-01-01T09:00:00Z",
        app: "Google Chrome",
        bundleId: "com.google.Chrome",
        grant: "denied",
      }),
      line({
        ts: "2026-01-01T09:00:10Z",
        app: "Google Chrome",
        bundleId: "com.google.Chrome",
        grant: "notAsked",
      }),
      line({
        ts: "2026-01-01T09:00:20Z",
        app: "Google Chrome",
        bundleId: "com.google.Chrome",
        grant: "denied",
      }),
    ];
    // When
    const saved = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        const device = yield* store.upsertDevice({
          kind: "mac",
          name: "Studio",
          externalId: "mac-1",
        });
        yield* collect(Stream.fromIterable(lines), device.id);
        return yield* store.getSetting("grant.com.google.Chrome");
      }).pipe(Effect.provide(Store.Test)),
    );
    // Then: the denial after the reset is written again, not deduped away
    expect(saved).toEqual(
      Option.some('{"state":"denied","checkedAt":"2026-01-01T09:00:20.000Z"}'),
    );
  });

  it("a line with no grant key still records", async () => {
    // Given: a Chrome line without a grant key, then a Finder line
    const lines = [
      line({
        ts: "2026-01-01T09:00:00Z",
        app: "Google Chrome",
        bundleId: "com.google.Chrome",
      }),
      line({
        ts: "2026-01-01T09:00:05Z",
        app: "Finder",
        bundleId: "com.apple.finder",
      }),
    ];
    // When
    const rows = await run(lines);
    // Then
    expect(rows).toEqual([
      {
        appName: "Google Chrome",
        title: null,
        url: null,
        startedAt: "2026-01-01T09:00:00.000Z",
        endedAt: "2026-01-01T09:00:05.000Z",
      },
    ]);
  });

  it("a failed Grant save logs and keeps recording", async () => {
    // Given: a Store whose first setSetting fails; Chrome denied twice, then Finder
    const lines = [
      line({
        ts: "2026-01-01T09:00:00Z",
        app: "Google Chrome",
        bundleId: "com.google.Chrome",
        grant: "denied",
      }),
      line({
        ts: "2026-01-01T09:00:02Z",
        app: "Google Chrome",
        bundleId: "com.google.Chrome",
        grant: "denied",
      }),
      line({
        ts: "2026-01-01T09:00:05Z",
        app: "Finder",
        bundleId: "com.apple.finder",
      }),
    ];
    let writes = 0;
    const flakySetSetting = Layer.effect(
      Store,
      Effect.map(
        Store,
        (s) =>
          new Store({
            ...s,
            setSetting: (key, value) => {
              writes += 1;
              return writes === 1
                ? Effect.fail(new StoreError({ cause: "disk full" }))
                : s.setSetting(key, value);
            },
          }),
      ),
    );
    // When
    const { rows, saved } = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        const device = yield* store.upsertDevice({
          kind: "mac",
          name: "Studio",
          externalId: "mac-1",
        });
        yield* collect(Stream.fromIterable(lines), device.id);
        const activities = yield* store.readActivities({
          from: DateTime.unsafeMake("2026-01-01T00:00:00Z"),
          to: DateTime.unsafeMake("2026-01-02T00:00:00Z"),
        });
        const saved = yield* store.getSetting("grant.com.google.Chrome");
        return {
          saved,
          rows: activities.map((a) => ({
            appName: a.appName,
            startedAt: DateTime.formatIso(a.startedAt),
            endedAt: DateTime.formatIso(a.endedAt),
          })),
        };
      }).pipe(Effect.provide(Layer.provide(flakySetSetting, Store.Test))),
    );
    // Then: the next heartbeat retries the failed save once, not on every line
    expect(writes).toBe(2);
    expect(saved).toEqual(
      Option.some('{"state":"denied","checkedAt":"2026-01-01T09:00:02.000Z"}'),
    );
    expect(rows).toEqual([
      {
        appName: "Google Chrome",
        startedAt: "2026-01-01T09:00:00.000Z",
        endedAt: "2026-01-01T09:00:05.000Z",
      },
    ]);
  });

  it("a notAsked line removes the Saved grant once", async () => {
    // Given: a Saved grant for Chrome, then two notAsked lines after a reset
    const lines = [
      line({
        ts: "2026-01-01T09:00:00Z",
        app: "Google Chrome",
        bundleId: "com.google.Chrome",
        grant: "notAsked",
      }),
      line({
        ts: "2026-01-01T09:00:02Z",
        app: "Google Chrome",
        bundleId: "com.google.Chrome",
        grant: "notAsked",
      }),
    ];
    let deletes = 0;
    const countedDelete = Layer.effect(
      Store,
      Effect.map(
        Store,
        (s) =>
          new Store({
            ...s,
            deleteSetting: (key) => {
              deletes += 1;
              return s.deleteSetting(key);
            },
          }),
      ),
    );
    // When
    const saved = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* store.setSetting(
          "grant.com.google.Chrome",
          '{"state":"granted","checkedAt":"2025-12-31T09:00:00.000Z"}',
        );
        const device = yield* store.upsertDevice({
          kind: "mac",
          name: "Studio",
          externalId: "mac-1",
        });
        yield* collect(Stream.fromIterable(lines), device.id);
        return yield* store.getSetting("grant.com.google.Chrome");
      }).pipe(Effect.provide(Layer.provide(countedDelete, Store.Test))),
    );
    // Then: the Saved grant is gone, and the second line writes nothing
    expect(saved).toEqual(Option.none());
    expect(deletes).toBe(1);
  });

  it("a failed Saved grant delete logs once and retries", async () => {
    // Given: a Saved grant for Chrome; the first save and the first delete
    // fail; Chrome denied, then notAsked three times
    const lines = [
      line({
        ts: "2026-01-01T09:00:00Z",
        app: "Google Chrome",
        bundleId: "com.google.Chrome",
        grant: "denied",
      }),
      ...["09:00:02", "09:00:04", "09:00:06"].map((t) =>
        line({
          ts: `2026-01-01T${t}Z`,
          app: "Google Chrome",
          bundleId: "com.google.Chrome",
          grant: "notAsked",
        }),
      ),
    ];
    let seeded = false;
    let deletes = 0;
    const flaky = Layer.effect(
      Store,
      Effect.map(
        Store,
        (s) =>
          new Store({
            ...s,
            setSetting: (key, value) => {
              if (!seeded) {
                seeded = true;
                return s.setSetting(key, value);
              }
              return Effect.fail(new StoreError({ cause: "disk full" }));
            },
            deleteSetting: (key) => {
              deletes += 1;
              return deletes === 1
                ? Effect.fail(new StoreError({ cause: "disk full" }))
                : s.deleteSetting(key);
            },
          }),
      ),
    );
    const logs: Array<string> = [];
    const testLogger = Logger.replace(
      Logger.defaultLogger,
      Logger.make(({ message }) => {
        logs.push(String(message));
      }),
    );
    // When
    const saved = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* store.setSetting(
          "grant.com.google.Chrome",
          '{"state":"granted","checkedAt":"2025-12-31T09:00:00.000Z"}',
        );
        const device = yield* store.upsertDevice({
          kind: "mac",
          name: "Studio",
          externalId: "mac-1",
        });
        yield* collect(Stream.fromIterable(lines), device.id);
        return yield* store.getSetting("grant.com.google.Chrome");
      }).pipe(
        Effect.provide(
          Layer.merge(Layer.provide(flaky, Store.Test), testLogger),
        ),
      ),
    );
    // Then: one warning of each kind, the delete is tried again once and
    // lands, and the third notAsked line writes nothing
    expect(logs).toEqual([
      "saved grant not written",
      "saved grant not deleted",
    ]);
    expect(deletes).toBe(2);
    expect(saved).toEqual(Option.none());
  });
});
