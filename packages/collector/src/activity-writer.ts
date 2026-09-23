import type { NewActivity } from "@clocktrace/core";
import { DateTime, Effect, Option, Ref } from "effect";

const minActivityMillis = 1000;

// An Activity before its end: what an "app started" event opens.
export type Started = Omit<NewActivity, "endedAt">;

export type ActivityWriter<E> = {
  readonly open: Effect.Effect<Option.Option<Started>>;
  readonly start: (
    next: Started,
  ) => Effect.Effect<Option.Option<NewActivity>, E>;
  readonly stop: (
    at: DateTime.Utc,
  ) => Effect.Effect<Option.Option<NewActivity>, E>;
};

// Turns "app started" and "app stopped" into closed Activities for one
// Device. A span closes on the next start or stop, a span under 1 s is
// dropped, and `privacy` blanks a Private one. The caller picks how often
// `privacy` reads the Rules, and stores what comes back its own way.
export const makeActivityWriter = <E>(
  privacy: Effect.Effect<(activity: NewActivity) => NewActivity, E>,
): Effect.Effect<ActivityWriter<E>> =>
  Effect.gen(function* () {
    const open = yield* Ref.make(Option.none<Started>());

    const close =
      (endedAt: DateTime.Utc) =>
      (
        closing: Option.Option<Started>,
      ): Effect.Effect<Option.Option<NewActivity>, E> =>
        Option.isNone(closing) ||
        DateTime.distance(closing.value.startedAt, endedAt) < minActivityMillis
          ? Effect.succeed(Option.none())
          : Effect.map(privacy, (blank) =>
              Option.some(blank({ ...closing.value, endedAt })),
            );

    return {
      open: Ref.get(open),
      start: (next) =>
        Ref.getAndSet(open, Option.some(next)).pipe(
          Effect.flatMap(close(next.startedAt)),
        ),
      stop: (at) =>
        Ref.getAndSet(open, Option.none()).pipe(Effect.flatMap(close(at))),
    };
  });
