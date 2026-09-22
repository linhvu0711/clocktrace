import { isoMinute } from "@clocktrace/core";
import { Options } from "@effect/cli";
import { Data, DateTime, Effect, Option } from "effect";

import { type Look, line, span } from "./format.js";

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

const timed = (side: string): boolean => side.charAt(10) === "T";

export const windowLine = (
  asked: { readonly from: string; readonly to: string },
  zone: string,
  look: Look,
  extra?: string,
): string => {
  const tail = extra === undefined ? ` · ${zone}` : ` · ${zone} · ${extra}`;
  if (!timed(asked.from) && !timed(asked.to)) {
    return asked.from === asked.to
      ? line(
          [span("head", asked.from), " ", span("dim", `whole day${tail}`)],
          look,
        )
      : line(
          [span("head", asked.from), " ", span("dim", `to ${asked.to}${tail}`)],
          look,
        );
  }
  const from = timed(asked.from) ? asked.from : `${asked.from}T00:00`;
  const to = timed(asked.to) ? asked.to : `${asked.to}T24:00`;
  const rest =
    from.slice(0, 10) === to.slice(0, 10)
      ? `${from.slice(11)} to ${to.slice(11)}`
      : `${from.slice(11)} to ${to.slice(0, 10)} ${to.slice(11)}`;
  return line(
    [span("head", from.slice(0, 10)), " ", span("dim", `${rest}${tail}`)],
    look,
  );
};

export const localMinute = (t: DateTime.Utc, zone: DateTime.TimeZone): string =>
  isoMinute(DateTime.setZone(t, zone));
