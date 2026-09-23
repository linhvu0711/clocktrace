import { Store, StoreError } from "@clocktrace/core";
import {
  Effect,
  Layer,
  Logger,
  Option,
  Schema,
  TestClock,
  TestContext,
} from "effect";
import { describe, expect, it } from "vitest";

import { App } from "../src/app.js";
import {
  checkAgain,
  type GrantItem,
  GrantPicture,
  grantCount,
  grantPicture,
  stateOf,
  tccService,
} from "../src/grant.js";
import { Helper, HelperExitedError, type Permissions } from "../src/helper.js";
import { CollectorPaths } from "../src/paths.js";

const NOW = Date.UTC(2026, 8, 19, 17, 30);

const encode = Schema.encodeSync(GrantPicture);

const allGranted: Permissions = {
  accessibility: "granted",
  automation: {},
  fullDiskAccess: "granted",
};

const stubHelper = (p: Permissions) =>
  Helper.Test({ permissions: () => Effect.succeed(p) });

// A Helper that gives each answer in turn and repeats the last one.
const answering = (...answers: ReadonlyArray<Permissions>) => {
  let calls = 0;
  return Helper.Test({
    permissions: () =>
      Effect.sync(
        () => answers[Math.min(calls++, answers.length - 1)] as Permissions,
      ),
  });
};

const appMissing = Layer.succeed(
  App,
  new App({
    isInstalled: () => Effect.succeed(false),
    install: () => Effect.succeed("written" as const),
    commit: () => Effect.void,
    rollback: () => Effect.void,
    remove: () => Effect.succeed("absent" as const),
  }),
);

const failing = (method: "setSetting" | "deleteSetting") =>
  Layer.provide(
    Layer.effect(
      Store,
      Effect.map(
        Store,
        (s) =>
          new Store({
            ...s,
            [method]: () => Effect.fail(new StoreError({ cause: "disk full" })),
          }),
      ),
    ),
    Store.Test,
  );

// Runs at NOW with the given Helper and App layers over one Store, with
// the paths of a fixed home folder.
const runAt = <A, E>(
  inside: Effect.Effect<A, E, Store | Helper | App | CollectorPaths>,
  helper: Layer.Layer<Helper>,
  options: {
    readonly app?: Layer.Layer<App>;
    readonly store?: Layer.Layer<Store, unknown>;
    readonly logs?: Array<string>;
  } = {},
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      return yield* inside.pipe(
        Effect.provide(
          Layer.mergeAll(
            helper,
            options.store ?? Store.Test,
            options.app ?? App.Test,
            CollectorPaths.Test,
            Logger.replace(
              Logger.defaultLogger,
              Logger.make(({ message }) => {
                options.logs?.push(String(message));
              }),
            ),
          ),
        ),
      );
    }).pipe(Effect.provide(TestContext.TestContext)),
  );

const seeded = (settings: ReadonlyArray<readonly [string, string]>) =>
  Effect.gen(function* () {
    const store = yield* Store;
    for (const [key, value] of settings) {
      yield* store.setSetting(key, value);
    }
  });

const names = (items: ReadonlyArray<GrantItem>) => items.map((i) => i.name);

describe("grant", () => {
  it("every grant granted and no browser used gives the no-browser item", async () => {
    // Given: every grant, no browser in the Helper's answer, an empty Store
    // When
    const picture = await runAt(grantPicture(), stubHelper(allGranted));
    // Then
    expect(encode(picture)).toEqual({
      app: "present",
      items: [
        {
          kind: "accessibility",
          bundleId: null,
          name: "accessibility",
          label: "Accessibility",
          gives: "window titles",
          loss: "window titles are not tracked",
          fix: "denied · turn it on in System Settings › Privacy › Accessibility",
          state: "granted",
          checkedAt: null,
        },
        {
          kind: "automation",
          bundleId: null,
          name: "automation",
          label: "Automation",
          gives: "browser URLs",
          loss: "browser URLs are not tracked",
          fix: "denied · turn it on in System Settings › Privacy › Automation",
          state: "noBrowser",
          checkedAt: null,
        },
        {
          kind: "fullDiskAccess",
          bundleId: null,
          name: "full disk access",
          label: "Full Disk Access",
          gives: "iPhone and iPad import",
          loss: "iPhone and iPad time is not imported",
          fix: "denied · turn it on in System Settings › Privacy › Full Disk Access",
          state: "granted",
          checkedAt: null,
        },
      ],
    });
  });

  it("each Helper state gives its item", async () => {
    // Given: one browser per Helper state, an empty Store
    // When
    const picture = await runAt(
      grantPicture(),
      stubHelper({
        accessibility: "notAsked",
        automation: {
          "com.brave.Browser": "granted",
          "com.google.Chrome": "denied",
          "com.microsoft.edgemac": "noAnswer",
          "com.apple.Safari": "notAsked",
          "com.operasoftware.Opera": "notInstalled",
          "com.vivaldi.Vivaldi": "notRunning",
        },
        fullDiskAccess: "denied",
      }),
    );
    // Then
    expect(
      picture.items.map((i) => [i.name, i.kind, i.bundleId, i.state]),
    ).toEqual([
      ["accessibility", "accessibility", null, "notAsked"],
      ["automation Brave", "automation", "com.brave.Browser", "granted"],
      ["automation Chrome", "automation", "com.google.Chrome", "denied"],
      ["automation Edge", "automation", "com.microsoft.edgemac", "noAnswer"],
      ["full disk access", "fullDiskAccess", null, "denied"],
    ]);
  });

  it("an unknown bundle id keeps its id", async () => {
    // Given: one browser not in the name map
    // When
    const picture = await runAt(
      grantPicture(),
      stubHelper({
        ...allGranted,
        automation: { "com.example.Browser": "granted" },
      }),
    );
    // Then
    const item = picture.items[1];
    expect([item?.name, item?.label, item?.bundleId]).toEqual([
      "automation com.example.Browser",
      "Automation · com.example.Browser",
      "com.example.Browser",
    ]);
  });

  it("a closed browser shows its Saved grant", async () => {
    // Given: Safari closed and Chrome not answering, each with a Saved grant
    // When
    const picture = await runAt(
      Effect.andThen(
        seeded([
          [
            "grant.com.apple.Safari",
            '{"state":"denied","checkedAt":"2026-09-19T18:00:00.000Z"}',
          ],
          [
            "grant.com.google.Chrome",
            '{"state":"granted","checkedAt":"2026-09-18T18:00:00.000Z"}',
          ],
        ]),
        grantPicture(),
      ),
      stubHelper({
        ...allGranted,
        automation: {
          "com.apple.Safari": "notRunning",
          "com.google.Chrome": "noAnswer",
        },
      }),
    );
    // Then: sorted by bundle id, so Safari first
    expect(
      encode(picture).items.filter((i) => i.kind === "automation"),
    ).toEqual([
      {
        kind: "automation",
        bundleId: "com.apple.Safari",
        name: "automation Safari",
        label: "Automation · Safari",
        gives: "URLs in Safari",
        loss: "URLs in Safari are not tracked",
        fix: "denied · turn it on in System Settings › Privacy › Automation",
        state: "denied",
        checkedAt: "2026-09-19T18:00:00.000Z",
      },
      {
        kind: "automation",
        bundleId: "com.google.Chrome",
        name: "automation Chrome",
        label: "Automation · Chrome",
        gives: "URLs in Chrome",
        loss: "URLs in Chrome are not tracked",
        fix: "denied · turn it on in System Settings › Privacy › Automation",
        state: "granted",
        checkedAt: "2026-09-18T18:00:00.000Z",
      },
    ]);
  });

  it("a closed browser with no Saved grant and a never-asked browser are left out", async () => {
    // Given: Safari closed with a Saved grant that does not decode, Chrome
    // never asked
    // When
    const picture = await runAt(
      Effect.andThen(
        seeded([["grant.com.apple.Safari", "not json"]]),
        grantPicture(),
      ),
      stubHelper({
        ...allGranted,
        automation: {
          "com.apple.Safari": "notRunning",
          "com.google.Chrome": "notAsked",
        },
      }),
    );
    // Then
    expect(names(picture.items)).toEqual([
      "accessibility",
      "automation",
      "full disk access",
    ]);
  });

  it("a check saves each granted or denied browser", async () => {
    // Given: Chrome answers granted and Brave denied at NOW
    // When
    const saved = await runAt(
      Effect.gen(function* () {
        yield* grantPicture();
        const store = yield* Store;
        return [
          yield* store.getSetting("grant.com.google.Chrome"),
          yield* store.getSetting("grant.com.brave.Browser"),
        ];
      }),
      stubHelper({
        ...allGranted,
        automation: {
          "com.google.Chrome": "granted",
          "com.brave.Browser": "denied",
        },
      }),
    );
    // Then
    expect(saved).toEqual([
      Option.some('{"state":"granted","checkedAt":"2026-09-19T17:30:00.000Z"}'),
      Option.some('{"state":"denied","checkedAt":"2026-09-19T17:30:00.000Z"}'),
    ]);
  });

  it("a check that finds notAsked removes the Saved grant", async () => {
    // Given: a Saved grant for Chrome, then a reset: Chrome answers notAsked
    // When
    const result = await runAt(
      Effect.gen(function* () {
        yield* seeded([
          [
            "grant.com.google.Chrome",
            '{"state":"granted","checkedAt":"2026-09-18T18:00:00.000Z"}',
          ],
        ]);
        const picture = yield* grantPicture();
        const store = yield* Store;
        return {
          saved: yield* store.getSetting("grant.com.google.Chrome"),
          names: names(picture.items),
        };
      }),
      stubHelper({
        ...allGranted,
        automation: { "com.google.Chrome": "notAsked" },
      }),
    );
    // Then
    expect(result).toEqual({
      saved: Option.none(),
      names: ["accessibility", "automation", "full disk access"],
    });
  });

  it("a missing App gives the not checked items and runs no Helper", async () => {
    // Given: no App, and a Helper that dies if it runs
    // When
    const picture = await runAt(
      grantPicture(),
      Helper.Test({ permissions: () => Effect.die("helper ran") }),
      { app: appMissing },
    );
    // Then
    expect(encode(picture)).toEqual({
      app: "missing",
      items: [
        {
          kind: "accessibility",
          bundleId: null,
          name: "accessibility",
          label: "Accessibility",
          gives: "window titles",
          loss: "window titles are not tracked",
          fix: "denied · turn it on in System Settings › Privacy › Accessibility",
          state: "notChecked",
          checkedAt: null,
        },
        {
          kind: "fullDiskAccess",
          bundleId: null,
          name: "full disk access",
          label: "Full Disk Access",
          gives: "iPhone and iPad import",
          loss: "iPhone and iPad time is not imported",
          fix: "denied · turn it on in System Settings › Privacy › Full Disk Access",
          state: "notChecked",
          checkedAt: null,
        },
      ],
    });
  });

  it("a Helper exit fails the picture", async () => {
    // Given: a Helper that exits
    // When
    const error = await runAt(
      Effect.flip(grantPicture()),
      Helper.Test({
        permissions: () =>
          Effect.fail(new HelperExitedError({ cause: "boom" })),
      }),
    );
    // Then
    expect([error._tag, error.message]).toEqual([
      "HelperExitedError",
      "helper exited: boom",
    ]);
  });

  it("a failed Saved grant write logs a warning and the picture still comes back", async () => {
    // Given: a Store whose setSetting fails; Chrome answers granted
    const logs: Array<string> = [];
    // When
    const picture = await runAt(
      grantPicture(),
      stubHelper({
        ...allGranted,
        automation: { "com.google.Chrome": "granted" },
      }),
      { store: failing("setSetting"), logs },
    );
    // Then
    expect({ logs, names: names(picture.items) }).toEqual({
      logs: ["saved grant not written"],
      names: ["accessibility", "automation Chrome", "full disk access"],
    });
  });

  it("a failed Saved grant delete logs a warning", async () => {
    // Given: a Store whose deleteSetting fails; Chrome reads notAsked and
    // Safari reads granted
    const logs: Array<string> = [];
    // When
    const safari = await runAt(
      Effect.gen(function* () {
        yield* grantPicture();
        const store = yield* Store;
        return yield* store.getSetting("grant.com.apple.Safari");
      }),
      stubHelper({
        ...allGranted,
        automation: {
          "com.google.Chrome": "notAsked",
          "com.apple.Safari": "granted",
        },
      }),
      { store: failing("deleteSetting"), logs },
    );
    // Then
    expect({ logs, safari: Option.isSome(safari) }).toEqual({
      logs: ["saved grant not deleted"],
      safari: true,
    });
  });

  it("grantCount counts the no-browser item as not granted", async () => {
    // Given: every grant granted and no browser used
    const picture = await runAt(grantPicture(), stubHelper(allGranted));
    // When
    const count = grantCount(picture.items);
    // Then
    expect(count).toBe("2 of 3 granted");
  });

  it("tccService names tccutil's services", () => {
    // Given: the three request kinds, automation with com.apple.Safari
    // When
    const services = [
      tccService({ kind: "accessibility" }),
      tccService({ kind: "automation", bundleId: "com.apple.Safari" }),
      tccService({ kind: "fullDiskAccess" }),
    ];
    // Then
    expect(services).toEqual([
      "Accessibility",
      "AppleEvents",
      "SystemPolicyAllFiles",
    ]);
  });

  it("check again after an ask gives the asked browser its live state", async () => {
    // Given: Safari and Chrome denied, then both granted on the next check
    // When
    const result = await runAt(
      Effect.gen(function* () {
        const picture = yield* grantPicture();
        const after = yield* checkAgain(picture, {
          kind: "automation",
          bundleId: "com.google.Chrome",
        });
        const store = yield* Store;
        return {
          states: after.items.map((i) => [i.name, i.state]),
          saved: yield* store.getSetting("grant.com.google.Chrome"),
        };
      }),
      answering(
        {
          ...allGranted,
          automation: {
            "com.apple.Safari": "denied",
            "com.google.Chrome": "denied",
          },
        },
        {
          ...allGranted,
          automation: {
            "com.apple.Safari": "granted",
            "com.google.Chrome": "granted",
          },
        },
      ),
    );
    // Then
    expect(result).toEqual({
      states: [
        ["accessibility", "granted"],
        ["automation Safari", "denied"],
        ["automation Chrome", "granted"],
        ["full disk access", "granted"],
      ],
      saved: Option.some(
        '{"state":"granted","checkedAt":"2026-09-19T17:30:00.000Z"}',
      ),
    });
  });

  it("check again keeps a closed browser's notRunning", async () => {
    // Given: Chrome denied, then closed on the next check
    const chrome = {
      kind: "automation",
      bundleId: "com.google.Chrome",
    } as const;
    // When
    const state = await runAt(
      Effect.gen(function* () {
        const picture = yield* grantPicture();
        return stateOf(yield* checkAgain(picture, chrome), chrome);
      }),
      answering(
        { ...allGranted, automation: { "com.google.Chrome": "denied" } },
        { ...allGranted, automation: { "com.google.Chrome": "notRunning" } },
      ),
    );
    // Then
    expect(state).toBe("notRunning");
  });

  it("check again after an Accessibility ask reads Accessibility", async () => {
    // Given: Accessibility denied, then granted on the next check
    const accessibility = { kind: "accessibility" } as const;
    // When
    const state = await runAt(
      Effect.gen(function* () {
        const picture = yield* grantPicture();
        return stateOf(
          yield* checkAgain(picture, accessibility),
          accessibility,
        );
      }),
      answering({ ...allGranted, accessibility: "denied" }, allGranted),
    );
    // Then
    expect(state).toBe("granted");
  });
});
