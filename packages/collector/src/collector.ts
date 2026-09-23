import { applyPrivate, Store, type StoreError } from "@clocktrace/core";
import { DateTime, Effect, Option, Ref, Stream } from "effect";
import type { ParseError } from "effect/ParseResult";

import { decodeHelperLine, type HelperLine } from "./helper-line.js";
import { deleteSavedGrant, saveGrant } from "./saved-grant.js";

export const idleAfterSeconds = 300;
export const minActivityMillis = 1000;

interface Open {
  readonly bundleId: string;
  readonly appName: string;
  readonly title: string | null;
  readonly url: string | null;
  readonly startedAt: DateTime.Utc;
}

interface State {
  readonly open: Open | null;
  readonly lastTs: DateTime.Utc | null;
  readonly idleClosed: boolean;
}

export const collect = <E, R>(
  lines: Stream.Stream<string, E, R>,
  deviceId: string,
): Effect.Effect<void, E | ParseError | StoreError, Store | R> =>
  Effect.gen(function* () {
    const store = yield* Store;
    const state = yield* Ref.make<State>({
      open: null,
      lastTs: null,
      idleClosed: false,
    });

    const close = (
      open: Open,
      endedAt: DateTime.Utc,
    ): Effect.Effect<void, ParseError | StoreError> =>
      DateTime.distance(open.startedAt, endedAt) < minActivityMillis
        ? Effect.void
        : Effect.gen(function* () {
            const blanked = yield* applyPrivate({
              deviceId,
              ...open,
              endedAt,
            }).pipe(Effect.provideService(Store, store));
            yield* store.insertActivity(blanked);
          });

    const remembered = yield* Ref.make<
      ReadonlyMap<
        string,
        {
          readonly state: "granted" | "denied" | "notAsked";
          readonly writtenAt: DateTime.Utc;
        }
      >
    >(new Map());
    const warned = yield* Ref.make<ReadonlySet<string>>(new Set());

    const warnOnce = (
      key: string,
      message: string,
      bundleId: string,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const seen = yield* Ref.get(warned);
        if (seen.has(key)) {
          return;
        }
        yield* Ref.update(warned, (s) => new Set(s).add(key));
        yield* Effect.logWarning(message).pipe(
          Effect.annotateLogs({ bundleId }),
        );
      });

    const remember = (line: HelperLine): Effect.Effect<void, never, Store> =>
      Effect.gen(function* () {
        const grant = line.grant;
        if (
          line.bundleId === null ||
          (grant !== "granted" && grant !== "denied" && grant !== "notAsked")
        ) {
          return;
        }
        const bundleId = line.bundleId;
        const last = yield* Ref.get(remembered);
        const saved = last.get(bundleId);
        if (
          saved !== undefined &&
          saved.state === grant &&
          DateTime.distance(saved.writtenAt, line.ts) >= 0 &&
          DateTime.distance(saved.writtenAt, line.ts) < 60_000
        ) {
          return;
        }
        // notAsked means macOS has no Grant any more (a reset, a new app
        // identity), so the Saved grant goes. Either write counts as done only
        // once it lands, so a failed one is tried again on the next line.
        const deleting = grant === "notAsked";
        yield* (
          deleting
            ? deleteSavedGrant(bundleId)
            : saveGrant(bundleId, grant, line.ts)
        ).pipe(
          Effect.tap(() =>
            Ref.set(
              remembered,
              new Map(last).set(bundleId, {
                state: grant,
                writtenAt: line.ts,
              }),
            ),
          ),
          Effect.catchTag("StoreError", () =>
            deleting
              ? warnOnce(
                  `delete:${bundleId}`,
                  "saved grant not deleted",
                  bundleId,
                )
              : warnOnce(
                  `save:${bundleId}`,
                  "saved grant not written",
                  bundleId,
                ),
          ),
        );
      });

    const step = (
      line: HelperLine,
    ): Effect.Effect<void, ParseError | StoreError> =>
      Effect.gen(function* () {
        const s = yield* Ref.get(state);
        yield* Ref.set(state, { ...s, lastTs: line.ts });
        if (line.idleSeconds >= idleAfterSeconds) {
          if (s.open !== null) {
            yield* Ref.set(state, {
              open: null,
              lastTs: line.ts,
              idleClosed: true,
            });
            yield* close(
              s.open,
              DateTime.subtract(line.ts, { seconds: line.idleSeconds }),
            );
          }
          return;
        }
        if (line.bundleId === null || line.app === null) {
          yield* Ref.set(state, {
            open: null,
            lastTs: line.ts,
            idleClosed: false,
          });
          if (s.open !== null) {
            yield* close(s.open, line.ts);
          }
          return;
        }
        if (s.open === null) {
          yield* Ref.set(state, {
            open: {
              bundleId: line.bundleId,
              appName: line.app,
              title: line.title,
              url: line.url,
              startedAt: s.idleClosed
                ? DateTime.subtract(line.ts, { seconds: line.idleSeconds })
                : line.ts,
            },
            lastTs: line.ts,
            idleClosed: false,
          });
          return;
        }
        if (
          s.open.bundleId !== line.bundleId ||
          s.open.appName !== line.app ||
          s.open.title !== line.title ||
          s.open.url !== line.url
        ) {
          yield* Ref.set(state, {
            open: {
              bundleId: line.bundleId,
              appName: line.app,
              title: line.title,
              url: line.url,
              startedAt: line.ts,
            },
            lastTs: line.ts,
            idleClosed: false,
          });
          yield* close(s.open, line.ts);
        }
      });

    const flush: Effect.Effect<void, ParseError | StoreError> = Effect.gen(
      function* () {
        const s = yield* Ref.get(state);
        if (s.open !== null && s.lastTs !== null) {
          yield* Ref.set(state, { ...s, open: null });
          yield* close(s.open, s.lastTs);
        }
      },
    );

    yield* lines.pipe(
      Stream.mapEffect((text) =>
        decodeHelperLine(text).pipe(
          Effect.map(Option.some),
          Effect.catchTag("ParseError", () =>
            Effect.logWarning("helper line rejected").pipe(
              Effect.as(Option.none()),
            ),
          ),
        ),
      ),
      Stream.filterMap((o) => o),
      Stream.tap(remember),
      Stream.runForEach(step),
      Effect.ensuring(Effect.orDie(flush)),
    );
  });
