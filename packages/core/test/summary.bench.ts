import { DateTime, Effect, ManagedRuntime } from "effect";
import { expect, test } from "vitest";

import { Store, summary } from "../src/index.js";

// Target: summary over one year of 100 000 Activities runs under 2 seconds on a
// Mac. This is a benchmark run by hand (`pnpm --filter core bench`), never in
// the test suite, so it never fails on time. The ~16 s of inserts is by design.
test("summary over one year of 100 000 Activities", async ({ bench }) => {
  // A ManagedRuntime keeps the seeded store alive across every bench
  // iteration; the store closes its db on scope exit, so re-providing the
  // layer per run would drop the 100 000 inserts.
  const runtime = ManagedRuntime.make(Store.Test);

  // Given: the Starter set (seeded by Store.Test), one Device, and a year of
  // synthetic Activities at 315 360 ms steps across ten apps and ten sites.
  await runtime.runPromise(
    Effect.gen(function* () {
      const store = yield* Store;
      const device = yield* store.getOrInsertDevice({
        kind: "mac",
        name: "Studio",
        externalId: "mac-1",
      });
      const apps = [
        "com.google.Chrome",
        "com.apple.Safari",
        "com.microsoft.VSCode",
        "com.tinyspeck.slackmacgap",
        "com.apple.Terminal",
        "com.figma.Desktop",
        "com.apple.Notes",
        "com.spotify.client",
        "com.apple.mail",
        "us.zoom.xos",
      ] as const;
      const sites = [
        "https://github.com/acme/shop",
        "https://stackoverflow.com/q/1",
        "https://linear.app/acme",
        "https://docs.google.com/document/d/1",
        "https://notion.so/page",
        "https://app.slack.com/client",
        "https://mail.google.com/mail",
        "https://figma.com/design/1",
        "https://reddit.com/r/rust",
        "https://youtube.com/watch?v=1",
      ] as const;
      const step = Math.floor((365 * 24 * 3600 * 1000) / 100_000);
      for (let i = 0; i < 100_000; i++) {
        const startedAt = Date.UTC(2025, 8, 1) + i * step;
        const bundleId = apps[i % apps.length] ?? "com.apple.Finder";
        const isBrowser =
          bundleId === "com.google.Chrome" || bundleId === "com.apple.Safari";
        yield* store.insertActivity({
          deviceId: device.id,
          bundleId,
          appName: bundleId,
          title: null,
          url: isBrowser ? (sites[i % sites.length] ?? null) : null,
          startedAt: DateTime.unsafeMake(startedAt),
          endedAt: DateTime.unsafeMake(startedAt + step - 1000),
        });
      }
    }),
  );

  // When: only the summary call is benchmarked, against the seeded store.
  let total = 0;
  const result = await bench(
    'summary({ groupBy: "category" }) over one year',
    async () => {
      const summ = await runtime.runPromise(
        summary({
          range: { from: "2025-09-01", to: "2026-08-31" },
          groupBy: "category",
        }).pipe(DateTime.withCurrentZoneNamed("America/Los_Angeles")),
      );
      total = summ.total;
    },
  ).run();

  // Then: print the measured time and assert only that summary produced data.
  // `process.stdout.write`, not `console.log`: vitest bench swallows console
  // output, and this keeps the file clear of the repo's noConsole lint rule.
  process.stdout.write(
    `summary over 100 000 Activities: ${result.latency.mean.toFixed(0)} ms mean (target: under 2 s on a Mac)\n`,
  );
  expect(total).toBeGreaterThan(0);

  await runtime.dispose();
}, 300_000);
