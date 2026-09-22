import { Schema } from "effect";

import { NewActivity } from "./activity.js";

/**
 * One Importer run's new Activities, the Progress each Device moves to,
 * and the run's status (CONTEXT.md, Import batch).
 */
export const ImportBatch = Schema.Struct({
  activities: Schema.Array(NewActivity),
  settings: Schema.Array(
    Schema.Struct({ key: Schema.String, value: Schema.String }),
  ),
});

export type ImportBatch = Schema.Schema.Type<typeof ImportBatch>;
