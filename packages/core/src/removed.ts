import { Schema } from "effect";

/** The input of every remove tool: the id of the thing to remove. */
export const RemoveInput = Schema.Struct({ id: Schema.String });

/** The reply of every remove tool: the id it removed. */
export const RemovedReply = Schema.Struct({ removed: Schema.String });
