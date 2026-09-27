import {
  type AppStore,
  type BlockSize,
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
  line,
  type Span,
  Style,
  span,
} from "./format.js";
import { jsonOption, report } from "./output.js";
import type { Prompt } from "./prompt.js";
import { whenSetUp } from "./set-up.js";
import { fromOption, requireWindow, toOption, windowLine } from "./window.js";

const guides = (look: Look) =>
  look.unicode
    ? { branch: "├─ ", last: "└─ ", through: "│  ", after: "   " }
    : { branch: "|- ", last: "`- ", through: "|  ", after: "   " };

const nameCell = (node: BreakdownNode): ReadonlyArray<string | Span> => {
  if (node.kind !== undefined && node.key !== undefined) {
    return [node.name, "  ", span("dim", `${node.kind} · ${node.key}`)];
  }
  if (node.small !== undefined) {
    return [span("dim", node.name)];
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
  const g = guides(look);
  const rows: Array<ReadonlyArray<Cell>> = [];
  const walk = (
    nodes: ReadonlyArray<BreakdownNode>,
    prefix: string | null,
  ): void => {
    nodes.forEach((node, i) => {
      const last = i === nodes.length - 1;
      const guide = prefix === null ? "" : prefix + (last ? g.last : g.branch);
      const time = duration(node.seconds);
      rows.push([
        node.small === undefined ? time : span("dim", time),
        [guide, ...nameCell(node)],
      ]);
      walk(
        node.children,
        prefix === null ? "" : prefix + (last ? g.after : g.through),
      );
    });
  };
  walk(block.nodes, null);
  rows.push([duration(block.seconds), span("head", "total")]);
  return columns(rows, look, { align: ["right"] });
};

/** A note about the answer, as a warning: the reply is less than the whole picture. */
export const noteLine = (note: string, look: Look): string =>
  line([span("warn", `! ${note}`)], look);

/** `HH:mm` of a Block time, read at the offset `±hh:mm`. */
const clockAt = (time: string, offset: string): string => {
  const sign = offset.startsWith("-") ? -1 : 1;
  const shift =
    sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
  return new Date(Date.parse(time) + shift * 60_000)
    .toISOString()
    .slice(11, 16);
};

// One header per Block, then its tree; a date line when the day changes, as
// the window line holds only the first date.
export const blocksScreen = (
  blocks: ReadonlyArray<BreakdownBlock>,
  look: Look,
): ReadonlyArray<string> => {
  // When DST ends a clock time comes twice; those Blocks show their offset.
  const offsets = new Map<string, Set<string>>();
  for (const block of blocks) {
    const seen = offsets.get(block.start.slice(0, 16)) ?? new Set<string>();
    offsets.set(block.start.slice(0, 16), seen.add(block.start.slice(16)));
  }
  return blocks.flatMap((block, i) => {
    const before = blocks[i - 1];
    const day = block.start.slice(0, 10);
    const offset = block.start.slice(16);
    const repeats = (offsets.get(block.start.slice(0, 16))?.size ?? 0) > 1;
    const label = repeats
      ? `${block.start.slice(11, 16)}–${clockAt(block.end, offset)} ${offset}`
      : `${block.start.slice(11, 16)}–${block.end.slice(11, 16)}`;
    const lead = [
      ...(before === undefined ? [] : [""]),
      ...(before === undefined || before.start.slice(0, 10) === day
        ? []
        : [line([span("head", day)], look)]),
    ];
    if (
      block.nodes.length === 0 ||
      block.first === undefined ||
      block.last === undefined
    ) {
      return [
        ...lead,
        line([span("head", label), "   ", span("dim", "no activity")], look),
      ];
    }
    const times = `first ${block.first.slice(11, 16)} · last ${block.last.slice(11, 16)}`;
    return [
      ...lead,
      line([span("head", label), "   ", span("dim", times)], look),
      ...breakdownScreen(block, look),
    ];
  });
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
    const block = input.block ?? "total";
    yield* report(json, encoded, (v) =>
      block === "total"
        ? [
            windowLine(input.range, v.range.zone, look, `by ${levels}`),
            ...v.notes.map((note) => noteLine(note, look)),
            ...v.blocks.flatMap((b) =>
              b.nodes.length === 0 ? [] : breakdownScreen(b, look),
            ),
          ]
        : [
            windowLine(
              input.range,
              v.range.zone,
              look,
              `by ${levels} · per ${block}`,
            ),
            ...v.notes.map((note) => noteLine(note, look)),
            ...(v.blocks.some((b) => b.nodes.length > 0)
              ? blocksScreen(v.blocks, look)
              : []),
          ],
    );
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

const search = Options.text("search").pipe(
  Options.optional,
  Options.withDescription(
    "count only Activities whose title or URL contains this word, in any case",
  ),
);

const block = Options.text("block").pipe(
  Options.optional,
  Options.withDescription(
    "total, hour, or 15min: one tree for the window, or one per clock hour or quarter-hour; default total",
  ),
);

export const breakdownCommand = Command.make(
  "breakdown",
  {
    from: fromOption,
    to: toOption,
    groupBy,
    min,
    devices,
    search,
    block,
    json: jsonOption,
  },
  ({ from, to, groupBy, min, devices, search, block, json }) =>
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
            search: Option.getOrUndefined(search),
            // Core checks the value and words the error.
            block: Option.getOrUndefined(block) as BlockSize | undefined,
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
