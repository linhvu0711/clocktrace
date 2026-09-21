import { isoMinute } from "@clocktrace/core";
import { Options } from "@effect/cli";
import { DateTime } from "effect";

export const fromOption = Options.text("from").pipe(
  Options.withDescription(
    "a local date YYYY-MM-DD or date-time YYYY-MM-DDTHH:mm; a bare date is midnight",
  ),
);

export const toOption = Options.text("to").pipe(
  Options.withDescription(
    "a local date YYYY-MM-DD or date-time YYYY-MM-DDTHH:mm; a bare date is the whole day",
  ),
);

export const deviceOption = Options.text("device").pipe(
  Options.optional,
  Options.withDescription("a Device id, the key of summary --group-by device"),
);

export const windowLine = (range: {
  readonly from: string;
  readonly to: string;
  readonly zone: string;
}): string => `${range.from} to ${range.to} ${range.zone}`;

export const localMinute = (t: DateTime.Utc, zone: DateTime.TimeZone): string =>
  isoMinute(DateTime.setZone(t, zone));
