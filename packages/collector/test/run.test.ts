import { Store } from "@clocktrace/core";
import {
  ConfigProvider,
  Effect,
  Exit,
  Fiber,
  Layer,
  Logger,
  Option,
  Queue,
  Ref,
  Stream,
  TestClock,
  TestContext,
} from "effect";
import { describe, expect, it } from "vitest";

import {
  Helper,
  HelperExitedError,
  HelperFailedError,
  HelperNotFoundError,
} from "../src/helper.js";
import { MacIdentity } from "../src/mac-identity.js";
import { runCollector } from "../src/run.js";

describe("run", () => {
  it("fails with HelperNotFoundError when the binary is missing", async () => {
    // Given: CLOCKTRACE_HELPER points at a path that does not exist
    const layers = Layer.mergeAll(Helper.Default, Store.Test, MacIdentity.Test);
    // When
    const exit = await Effect.runPromise(
      Effect.exit(runCollector()).pipe(
        Effect.provide(layers),
        Effect.withConfigProvider(
          ConfigProvider.fromMap(
            new Map([["CLOCKTRACE_HELPER", "/nope/clocktrace-helper"]]),
          ),
        ),
      ),
    );
    // Then
    expect(exit).toEqual(
      Exit.fail(new HelperNotFoundError({ path: "/nope/clocktrace-helper" })),
    );
    if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
      expect((exit.cause.error as HelperNotFoundError).message).toBe(
        "helper not found at /nope/clocktrace-helper · run pnpm build or set CLOCKTRACE_HELPER",
      );
    }
  });

  it("restarts the helper with backoff and logs one line each time", async () => {
    // Given: a helper stub whose lines stream fails with HelperExitedError
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const starts = yield* Queue.unbounded<number>();
        const count = yield* Ref.make(0);
        const logs = yield* Queue.unbounded<string>();
        const stubHelper = Helper.Test({
          lines: () =>
            Stream.fromEffect(
              Ref.updateAndGet(count, (n) => n + 1).pipe(
                Effect.tap((n) => Queue.offer(starts, n)),
              ),
            ).pipe(
              Stream.drain,
              Stream.concat(
                Stream.fail(new HelperExitedError({ cause: "test" })),
              ),
            ),
        });
        const testLogger = Logger.replace(
          Logger.defaultLogger,
          Logger.make(({ message }) =>
            Queue.unsafeOffer(logs, String(message)),
          ),
        );
        const layers = Layer.mergeAll(
          stubHelper,
          Store.Test,
          MacIdentity.Test,
          testLogger,
        );
        // When
        const fiber = yield* Effect.fork(
          runCollector().pipe(
            Effect.provide(layers),
            Effect.withConfigProvider(
              ConfigProvider.fromMap(new Map([["CLOCKTRACE_HELPER", "/stub"]])),
            ),
          ),
        );
        yield* Queue.take(logs); // "collector started"
        const a = yield* Queue.take(starts);
        const l1 = yield* Queue.take(logs);
        const p1 = yield* Queue.poll(starts);
        yield* TestClock.adjust("1 second");
        const b = yield* Queue.take(starts);
        const l2 = yield* Queue.take(logs);
        const p2 = yield* Queue.poll(starts);
        yield* TestClock.adjust("2 seconds");
        const c = yield* Queue.take(starts);
        const l3 = yield* Queue.take(logs);
        const p3 = yield* Queue.poll(starts);
        yield* TestClock.adjust("4 seconds");
        const d = yield* Queue.take(starts);
        const l4 = yield* Queue.take(logs);
        yield* Fiber.interrupt(fiber);
        return { a, b, c, d, p1, p2, p3, l1, l2, l3, l4 };
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    // Then
    expect([result.a, result.b, result.c, result.d]).toEqual([1, 2, 3, 4]);
    expect([result.p1, result.p2, result.p3]).toEqual([
      Option.none(),
      Option.none(),
      Option.none(),
    ]);
    expect([result.l1, result.l2, result.l3, result.l4]).toEqual([
      "helper exited, restarting",
      "helper exited, restarting",
      "helper exited, restarting",
      "helper exited, restarting",
    ]);
  });

  it("runs the import on start and again after 15 minutes through the watch path", async () => {
    // Given: a stub helper whose biome calls succeed
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const imports = yield* Queue.unbounded<number>();
        const count = yield* Ref.make(0);
        const stubHelper = Helper.Test({
          biomeDevices: () =>
            Ref.updateAndGet(count, (n) => n + 1).pipe(
              Effect.tap((n) => Queue.offer(imports, n)),
              Effect.as([
                {
                  deviceIdentifier: "00000000-0000-4000-8000-000000000002",
                  lastSyncDate: null,
                  me: false,
                  model: "24A437",
                  name: "",
                  platform: 2,
                },
              ]),
            ),

          lines: () => Stream.never,
        });
        const layers = Layer.mergeAll(stubHelper, Store.Test, MacIdentity.Test);
        // When
        const fiber = yield* Effect.fork(
          runCollector().pipe(
            Effect.provide(layers),
            Effect.withConfigProvider(
              ConfigProvider.fromMap(new Map([["CLOCKTRACE_HELPER", "/stub"]])),
            ),
          ),
        );
        const a = yield* Queue.take(imports);
        yield* TestClock.adjust("15 minutes");
        const b = yield* Queue.take(imports);
        yield* Fiber.interrupt(fiber);
        return { a, b };
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    // Then
    expect([result.a, result.b]).toEqual([1, 2]);
  });

  it("a failing import keeps the Mac tracking", async () => {
    // Given: a stub helper whose biome devices call fails and whose lines
    // stream runs forever
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const starts = yield* Queue.unbounded<number>();
        const stubHelper = Helper.Test({
          biomeDevices: () =>
            Effect.fail(
              new HelperFailedError({
                code: 2,
                stderr: "usage: clocktrace-helper\n",
              }),
            ),

          lines: () =>
            Stream.fromEffect(Queue.offer(starts, 1)).pipe(
              Stream.drain,
              Stream.concat(Stream.never),
            ),
        });
        const layers = Layer.mergeAll(stubHelper, Store.Test, MacIdentity.Test);
        // When
        const fiber = yield* Effect.fork(
          runCollector().pipe(
            Effect.provide(layers),
            Effect.withConfigProvider(
              ConfigProvider.fromMap(new Map([["CLOCKTRACE_HELPER", "/stub"]])),
            ),
          ),
        );
        const a = yield* Queue.take(starts);
        yield* Fiber.interrupt(fiber);
        return { a };
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    // Then: the helper watch stream started despite the failed import
    expect(result.a).toBe(1);
  });
});
