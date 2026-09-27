import {
  type AppStore,
  type BreakdownBlock,
  type BreakdownInput,
  type BreakdownNode,
  BreakdownReply,
  breakdown,
  type DeviceNotFoundError,
  defaultLevels,
  type InvalidInputError,
  type InvalidRangeError,
  type Level,
  type Store,
  type StoreError,
} from "@clocktrace/core";
import { Command, Options } from "@effect/cli";
import { type DateTime, Effect, Option, Schema } from "effect";
import type { ParseError } from "effect/ParseResult";

import {
  type Cell,
  columns,
  duration,
  type Look,
  type Span,
  Style,
  span,
} from "./format.js";
import { jsonOption, report } from "./output.js";
import type { Prompt } from "./prompt.js";
import { whenSetUp } from "./set-up.js";
import { fromOption, requireWindow, toOption, windowLine } from "./window.js";

const guides = { branch: "├─ ", last: "└─ ", through: "│  ", after: "   " };

const nameCell = (node: BreakdownNode): ReadonlyArray<string | Span> => {
  if (node.kind !== undefined && node.key !== undefined) {
    return [node.name, "  ", span("dim", `${node.kind} · ${node.key}`)];
  }
  if (node.productive !== undefined) {
    return [
      node.name,
      "  ",
      node.productive
        ? span("ok", "productive")
        : span("dim", "not productive"),
    ];
  }
  return [node.name];
};

// The duration comes first and the tree last, so `columns` cuts a long
// title to the terminal width.
export const breakdownScreen = (
  block: BreakdownBlock,
  look: Look,
): ReadonlyArray<string> => {
  const rows: Array<ReadonlyArray<Cell>> = [];
  const walk = (
    nodes: ReadonlyArray<BreakdownNode>,
    prefix: string | null,
  ): void => {
    nodes.forEach((node, i) => {
      const last = i === nodes.length - 1;
      const guide =
        prefix === null ? "" : prefix + (last ? guides.last : guides.branch);
      rows.push([duration(node.seconds), [guide, ...nameCell(node)]]);
      walk(
        node.children,
        prefix === null ? "" : prefix + (last ? guides.after : guides.through),
      );
    });
  };
  walk(block.nodes, null);
  rows.push([duration(block.seconds), span("head", "total")]);
  return columns(rows, look, { align: ["right"] });
};

export const printBreakdown = (
  input: Schema.Schema.Encoded<typeof BreakdownInput>,
  json: boolean,
): Effect.Effect<
  void,
  | InvalidInputError
  | InvalidRangeError
  | DeviceNotFoundError
  | StoreError
  | ParseError,
  Store | AppStore | Prompt | DateTime.CurrentTimeZone | Style
> =>
  Effect.gen(function* () {
    const look = yield* Style;
    const reply = yield* breakdown(input);
    const encoded = yield* Schema.encode(BreakdownReply)(reply);
    const levels = (input.groupBy ?? defaultLevels).join(", ");
    yield* report(json, encoded, (v) => [
      windowLine(input.range, v.range.zone, look, `by ${levels}`),
      ...v.notes,
      ...v.blocks.flatMap((block) =>
        block.nodes.length === 0 ? [] : breakdownScreen(block, look),
      ),
    ]);
  });

/** The items of a comma-separated flag value; empty items stay for core to reject. */
export const commaList = (text: string): ReadonlyArray<string> =>
  text.split(",").map((item) => item.trim());

const groupBy = Options.text("group-by").pipe(
  Options.optional,
  Options.withDescription(
    "levels in order, comma-separated: category, project, device, app, domain, title; default device,app,domain,title",
  ),
);

const min = Options.text("min").pipe(
  Options.optional,
  Options.withDescription(
    "merge sibling lines under this, as 60s or 2m; default 60s",
  ),
);

const devices = Options.text("devices").pipe(
  Options.optional,
  Options.withDescription(
    "Device kinds (mac, iphone, ipad) or Device ids, comma-separated; default all",
  ),
);

export const breakdownCommand = Command.make(
  "breakdown",
  { from: fromOption, to: toOption, groupBy, min, devices, json: jsonOption },
  ({ from, to, groupBy, min, devices, json }) =>
    Effect.gen(function* () {
      const range = yield* requireWindow("breakdown", from, to);
      return yield* whenSetUp(
        printBreakdown(
          {
            range,
            // Core checks each level and words the error.
            groupBy: Option.getOrUndefined(Option.map(groupBy, commaList)) as
              | ReadonlyArray<Level>
              | undefined,
            min: Option.getOrUndefined(min),
            devices: Option.getOrUndefined(Option.map(devices, commaList)),
          },
          json,
        ),
      );
    }),
).pipe(
  Command.withDescription(
    "show time as a tree by device, app, domain, and title",
  ),
);
