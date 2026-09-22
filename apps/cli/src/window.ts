import { isoMinute } from "@clocktrace/core";
import { Options } from "@effect/cli";
import { Data, DateTime, Effect, Option } from "effect";

export const fromOption = Options.text("from").pipe(
  Options.optional,
  Options.withDescription(
    "a local date YYYY-MM-DD or date-time YYYY-MM-DDTHH:mm; a bare date is midnight",
  ),
);

export const toOption = Options.text("to").pipe(
  Options.optional,
  Options.withDescription(
    "a local date YYYY-MM-DD or date-time YYYY-MM-DDTHH:mm; a bare date is the whole day",
  ),
);

export const deviceOption = Options.text("device").pipe(
  Options.optional,
  Options.withDescription("a Device id, see summary --group-by device"),
);

export class MissingWindowError extends Data.TaggedError("MissingWindowError")<{
  readonly command: string;
}> {}

// --from and --to are parsed as optional so @effect/cli never prints its own
// "Expected to find option" line; the command asks for them itself here.
export const requireWindow = (
  command: string,
  from: Option.Option<string>,
  to: Option.Option<string>,
): Effect.Effect<
  { readonly from: string; readonly to: string },
  MissingWindowError
> =>
  Option.isSome(from) && Option.isSome(to)
    ? Effect.succeed({ from: from.value, to: to.value })
    : Effect.fail(new MissingWindowError({ command }));

export const windowLine = (range: {
  readonly from: string;
  readonly to: string;
  readonly zone: string;
}): string => `${range.from} to ${range.to} ${range.zone}`;

export const localMinute = (t: DateTime.Utc, zone: DateTime.TimeZone): string =>
  isoMinute(DateTime.setZone(t, zone));
