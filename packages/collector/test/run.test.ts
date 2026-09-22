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
        const stubHelper = Layer.succeed(
          Helper,
          new Helper({
            check: () => Effect.void,
            permissions: () =>
              Effect.succeed({
                accessibility: "granted",
                automation: {},
                fullDiskAccess: "granted",
              }),
            request: () => Effect.succeed("asked"),
            biomeDevices: () => Effect.succeed([]),
            biomeRecords: () => Effect.succeed([]),
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
          }),
        );
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
});
