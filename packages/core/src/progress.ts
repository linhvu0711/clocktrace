import { DateTime, Effect, Option, Schema } from "effect";

import type { Device } from "./device.js";
import type { StoreError } from "./errors.js";
import type { Store } from "./store.js";

export const ImportProgress = Schema.parseJson(
  Schema.Struct({
    segment: Schema.String,
    offset: Schema.Number,
    ts: Schema.Number,
  }),
);

export type ImportProgress = Schema.Schema.Type<typeof ImportProgress>;

export const importProgressKey = (externalId: string): string =>
  `importer.progress.${externalId}`;

/** A Device's Progress; none when it has no records yet or the value does not decode. */
export const readProgress = (
  store: Store,
  externalId: string,
): Effect.Effect<Option.Option<ImportProgress>, StoreError> =>
  Effect.gen(function* () {
    const stored = yield* store.getSetting(importProgressKey(externalId));
    return yield* Effect.option(
      Schema.decodeUnknown(ImportProgress)(Option.getOrElse(stored, () => "")),
    );
  });

/** How far a Device's data goes: the later of its Progress time and its last Activity end; none when it has neither. */
export const dataUpTo = (
  store: Store,
  device: Device,
): Effect.Effect<Option.Option<DateTime.Utc>, StoreError> =>
  Effect.gen(function* () {
    const progress = yield* readProgress(store, device.externalId);
    const lastActivity = yield* store.latestActivityEnd(device.id);
    // How far the data goes: Progress waits while an Activity is
    // open, so a written Activity can end after it.
    const ends = [
      Option.map(progress, (p) => DateTime.unsafeMake(p.ts * 1000)),
      lastActivity,
    ].flatMap(Option.toArray);
    return ends.length === 0
      ? Option.none()
      : Option.some(ends.reduce((a, b) => DateTime.max(a, b)));
  });
