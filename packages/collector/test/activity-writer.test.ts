import {
  addRule,
  type NewActivity,
  readPrivate,
  Store,
  type StoreError,
} from "@clocktrace/core";
import { DateTime, Effect, Option } from "effect";
import { describe, expect, it } from "vitest";

import {
  type ActivityWriter,
  makeActivityWriter,
  type Started,
} from "../src/activity-writer.js";

const run = <A, E>(
  body: (
    writer: ActivityWriter<StoreError>,
    started: (
      o: Omit<Started, "deviceId" | "startedAt"> & { readonly at: string },
    ) => Started,
  ) => Effect.Effect<A, E, Store>,
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* Store;
      const device = yield* store.upsertDevice({
        kind: "mac",
        name: "Studio",
        externalId: "mac-1",
      });
      const writer = yield* makeActivityWriter(
        readPrivate.pipe(Effect.provideService(Store, store)),
      );
      return yield* body(writer, ({ at, ...o }) => ({
        deviceId: device.id,
        ...o,
        startedAt: DateTime.unsafeMake(at),
      }));
    }).pipe(Effect.provide(Store.Test)),
  );

const view = (closed: Option.Option<NewActivity>) =>
  Option.getOrNull(
    Option.map(closed, (a) => ({
      appName: a.appName,
      title: a.title,
      url: a.url,
      startedAt: DateTime.formatIso(a.startedAt),
      endedAt: DateTime.formatIso(a.endedAt),
    })),
  );

const safari = {
  bundleId: "com.apple.Safari",
  appName: "Safari",
  title: "Example Domain",
  url: "https://example.com/",
};

describe("activity writer", () => {
  it("a start closes the open span at the next start", async () => {
    const closed = await run((writer, started) =>
      Effect.gen(function* () {
        // Given: Safari open at 00:00:00
        yield* writer.start(
          started({ ...safari, at: "2026-01-01T00:00:00.000Z" }),
        );
        // When
        return yield* writer.start(
          started({
            bundleId: "com.apple.TextEdit",
            appName: "TextEdit",
            title: "Untitled",
            url: null,
            at: "2026-01-01T00:00:05.000Z",
          }),
        );
      }),
    );
    // Then
    expect(view(closed)).toEqual({
      appName: "Safari",
      title: "Example Domain",
      url: "https://example.com/",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:05.000Z",
    });
  });

  it("a stop closes the open span at the stop time and leaves none open", async () => {
    const result = await run((writer, started) =>
      Effect.gen(function* () {
        // Given: Safari open at 00:00:00
        yield* writer.start(
          started({ ...safari, at: "2026-01-01T00:00:00.000Z" }),
        );
        // When
        const closed = yield* writer.stop(
          DateTime.unsafeMake("2026-01-01T00:00:07.000Z"),
        );
        const open = yield* writer.open;
        return { closed: view(closed), open: Option.getOrNull(open) };
      }),
    );
    // Then
    expect(result).toEqual({
      closed: {
        appName: "Safari",
        title: "Example Domain",
        url: "https://example.com/",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T00:00:07.000Z",
      },
      open: null,
    });
  });

  it("a span under 1 s is dropped", async () => {
    const closed = await run((writer, started) =>
      Effect.gen(function* () {
        // Given: TextEdit open at 00:00:05.000
        yield* writer.start(
          started({
            bundleId: "com.apple.TextEdit",
            appName: "TextEdit",
            title: null,
            url: null,
            at: "2026-01-01T00:00:05.000Z",
          }),
        );
        // When: Safari starts 400 ms later
        return yield* writer.start(
          started({
            bundleId: "com.apple.Safari",
            appName: "Safari",
            title: null,
            url: null,
            at: "2026-01-01T00:00:05.400Z",
          }),
        );
      }),
    );
    // Then
    expect(view(closed)).toBeNull();
  });

  it("a Private rule blanks title and url", async () => {
    const closed = await run((writer, started) =>
      Effect.gen(function* () {
        // Given: the Starter set's `(Incognito)` rule is Private
        yield* writer.start(
          started({
            bundleId: "com.google.Chrome",
            appName: "Google Chrome",
            title: "Example Domain - Google Chrome (Incognito)",
            url: "https://example.com/",
            at: "2026-01-01T00:00:00.000Z",
          }),
        );
        // When
        return yield* writer.stop(
          DateTime.unsafeMake("2026-01-01T00:00:10.000Z"),
        );
      }),
    );
    // Then
    expect(view(closed)).toEqual({
      appName: "Google Chrome",
      title: null,
      url: null,
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:10.000Z",
    });
  });

  it("a Brave private window title is blanked", async () => {
    const closed = await run((writer, started) =>
      Effect.gen(function* () {
        // Given: the Starter set's `(Private)` rule matches Brave's private suffix
        yield* writer.start(
          started({
            bundleId: "com.brave.Browser",
            appName: "Brave Browser",
            title: "Example - Brave (Private)",
            url: "https://example.com/",
            at: "2026-01-01T00:00:00.000Z",
          }),
        );
        // When
        return yield* writer.stop(
          DateTime.unsafeMake("2026-01-01T00:00:10.000Z"),
        );
      }),
    );
    // Then
    expect(view(closed)).toEqual({
      appName: "Brave Browser",
      title: null,
      url: null,
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:10.000Z",
    });
  });

  it("a Private rule added between two writes applies to the second", async () => {
    const written = await run((writer, started) =>
      Effect.gen(function* () {
        // Given: two Safari spans, and a Private rule added after the first closes
        yield* writer.start(
          started({
            ...safari,
            title: "Secret plan",
            url: "https://example.com/a",
            at: "2026-01-01T00:00:00.000Z",
          }),
        );
        const first = yield* writer.start(
          started({
            ...safari,
            title: "Secret notes",
            url: "https://example.com/b",
            at: "2026-01-01T00:00:05.000Z",
          }),
        );
        yield* addRule({
          field: "title",
          compare: "contains",
          value: "Secret",
          effect: "private",
          target: null,
        });
        // When
        const second = yield* writer.stop(
          DateTime.unsafeMake("2026-01-01T00:00:10.000Z"),
        );
        return [view(first), view(second)];
      }),
    );
    // Then
    expect(written).toEqual([
      {
        appName: "Safari",
        title: "Secret plan",
        url: "https://example.com/a",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T00:00:05.000Z",
      },
      {
        appName: "Safari",
        title: null,
        url: null,
        startedAt: "2026-01-01T00:00:05.000Z",
        endedAt: "2026-01-01T00:00:10.000Z",
      },
    ]);
  });
});
