import { Store, StoreError } from "@clocktrace/core";
import {
  DateTime,
  Deferred,
  Effect,
  Fiber,
  Layer,
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

  it("the same Grant is saved once", async () => {
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
});
