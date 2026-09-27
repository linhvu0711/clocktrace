import { DateTime, Effect, Option, Schema } from "effect";

import type { AppStore } from "./app-store.js";
import type { Category } from "./category.js";
import { type Device, DeviceKind } from "./device.js";
import {
  DeviceNotFoundError,
  type InvalidInputError,
  type InvalidRangeError,
  type StoreError,
} from "./errors.js";
import { decodeInput } from "./input.js";
import { domainOf } from "./matcher.js";
import { dataUpTo } from "./progress.js";
import type { Project } from "./project.js";
import { isoMinute, Range, UsedRange } from "./range.js";
import { loadRange, type RangeRows } from "./range-rows.js";
import { Store } from "./store.js";

// override: without it the literal union keeps Effect's own words.
export const Level = Schema.Literal(
  "category",
  "project",
  "device",
  "app",
  "domain",
  "title",
  "page",
).annotations({
  message: () => ({
    message:
      "must be one of category, project, device, app, domain, title, page",
    override: true,
  }),
});

const Levels = Schema.Array(Level).pipe(
  Schema.minItems(1, { message: () => "must name at least one level" }),
  Schema.filter(
    (levels) =>
      new Set(levels).size === levels.length || "must not name a level twice",
  ),
);

// The pattern carries the message, so abc and -5s get core's words.
const minRule = {
  message: () => "must be a whole number with s or m, as 60s or 2m",
};

/** `60s` or `2m` as text, seconds once decoded. */
const Min = Schema.transform(
  Schema.String.pipe(Schema.pattern(/^\d+[sm]$/, minRule)),
  Schema.Int,
  {
    strict: true,
    decode: (text) => Number(text.slice(0, -1)) * (text.endsWith("m") ? 60 : 1),
    encode: (seconds) => `${seconds}s`,
  },
);

const DeviceSelector = Schema.Union(DeviceKind, Schema.UUID).annotations({
  message: () => ({
    message: "must be a Device kind (mac, iphone, ipad) or a Device id",
    override: true,
  }),
});

export const defaultLevels: ReadonlyArray<Level> = [
  "device",
  "app",
  "domain",
  "page",
];

export const BlockSize = Schema.Literal("total", "hour", "15min").annotations({
  message: () => ({
    message: "must be one of total, hour, 15min",
    override: true,
  }),
});

const nodeFields = {
  name: Schema.String,
  seconds: Schema.Int,
  /** The Device, bundle, Category, or Project id behind the line, or a page's URL. */
  key: Schema.optionalWith(Schema.String, { exact: true }),
  /** On a page line with a URL: its path and query, as /watch?v=…; left out when both are empty. */
  path: Schema.optionalWith(Schema.String, { exact: true }),
  kind: Schema.optionalWith(DeviceKind, { exact: true }),
  productive: Schema.optionalWith(Schema.Boolean, { exact: true }),
  /** On an "N small items" line: how many lines it merges. */
  small: Schema.optionalWith(Schema.Int, { exact: true }),
  /** On a "(private)" line: its Activities are marked Private. */
  private: Schema.optionalWith(Schema.Boolean, { exact: true }),
};

// Schema.suspend needs a declared type; it takes every field from the
// Schema and adds only the recursive one.
export interface BreakdownNode extends Schema.Struct.Type<typeof nodeFields> {
  readonly children: ReadonlyArray<BreakdownNode>;
}

export const BreakdownNode: Schema.Schema<BreakdownNode> = Schema.Struct({
  ...nodeFields,
  children: Schema.Array(
    Schema.suspend((): Schema.Schema<BreakdownNode> => BreakdownNode),
  ),
}).annotations({ identifier: "BreakdownNode" });

export const BreakdownBlock = Schema.Struct({
  /** Local time with offset, YYYY-MM-DDTHH:mm±hh:mm. */
  start: Schema.String,
  end: Schema.String,
  /** The first activity start and the last activity end in the Block, cut to it; left out when it has none. */
  first: Schema.optionalWith(Schema.String, { exact: true }),
  last: Schema.optionalWith(Schema.String, { exact: true }),
  seconds: Schema.Int,
  nodes: Schema.Array(BreakdownNode),
});

export const BreakdownReply = Schema.Struct({
  range: UsedRange,
  blocks: Schema.Array(BreakdownBlock),
  notes: Schema.Array(Schema.String),
});

export const BreakdownInput = Schema.Struct({
  range: Range,
  groupBy: Schema.optionalWith(Levels, { default: () => defaultLevels }),
  min: Schema.optionalWith(Min, { default: () => 60 }),
  block: Schema.optionalWith(BlockSize, { default: () => "total" as const }),
  devices: Schema.optional(
    Schema.Array(DeviceSelector).pipe(
      Schema.minItems(1, { message: () => "must name at least one Device" }),
    ),
  ),
  search: Schema.optional(
    Schema.String.pipe(
      Schema.minLength(1, { message: () => "must not be empty" }),
    ),
  ),
});

type Row = RangeRows["rows"][number];

/** The title or URL holds the word, in any case; a row with neither never matches. */
const matches = (row: Row, word: string): boolean => {
  const w = word.toLowerCase();
  return [row.activity.title, row.activity.url].some(
    (text) => text?.toLowerCase().includes(w) === true,
  );
};

interface Lookups {
  readonly categoryById: ReadonlyMap<string, Category>;
  readonly projectById: ReadonlyMap<string, Project>;
  readonly deviceById: ReadonlyMap<string, Device>;
}

type Line = Omit<BreakdownNode, "seconds" | "children">;

/** One row's value at one level: the id it groups by, and its line. */
interface Part {
  readonly id: string;
  readonly line: Line;
  /** No domain or no title: shown only beside siblings. */
  readonly empty: boolean;
  /** A page with a URL: its line takes the title with the most time. */
  readonly titled: boolean;
}

// No domain or title holds a NUL, so a Private line never merges with a real value.
const privateId = "\u0000private";

/** A URL's page: the stored text before its #… part, and its path and query. */
const pageOf = (
  url: string | null,
): { readonly key: string; readonly path: string } | null => {
  if (url === null || url === "") {
    return null;
  }
  try {
    const parsed = new URL(url);
    return {
      key: url.split("#", 1)[0] ?? url,
      path: parsed.pathname + parsed.search,
    };
  } catch {
    return null;
  }
};

const partOf = (level: Level, { activity, resolution }: Row, l: Lookups) => {
  const part = (
    id: string,
    line: Line,
    empty = false,
    titled = false,
  ): Part => ({
    id,
    line,
    empty,
    titled,
  });
  switch (level) {
    case "category": {
      const category =
        resolution.categoryId === null
          ? undefined
          : l.categoryById.get(resolution.categoryId);
      return category === undefined
        ? part("uncategorized", { name: "Uncategorized" })
        : part(category.id, {
            name: category.name,
            key: category.id,
            productive: category.productive,
          });
    }
    case "project": {
      const project =
        resolution.projectId === null
          ? undefined
          : l.projectById.get(resolution.projectId);
      return project === undefined
        ? part("no-project", { name: "No project" })
        : part(project.id, { name: project.name, key: project.id });
    }
    case "device": {
      const device = l.deviceById.get(activity.deviceId);
      return part(
        activity.deviceId,
        device === undefined
          ? { name: activity.deviceId, key: activity.deviceId }
          : { name: device.name, key: device.id, kind: device.kind },
      );
    }
    case "app":
      return part(activity.bundleId, {
        name: activity.appName,
        key: activity.bundleId,
      });
    case "domain": {
      if (activity.private) {
        return part(privateId, { name: "(private)", private: true });
      }
      const domain = domainOf(activity.url) ?? "";
      return domain === ""
        ? part("", { name: "(no domain)" }, true)
        : part(domain, { name: domain });
    }
    case "title": {
      if (activity.private) {
        return part(privateId, { name: "(private)", private: true });
      }
      const title = activity.title ?? "";
      return title === ""
        ? part("", { name: "(no title)" }, true)
        : part(title, { name: title });
    }
    case "page": {
      if (activity.private) {
        return part(privateId, { name: "(private)", private: true });
      }
      const page = pageOf(activity.url);
      if (page !== null) {
        return part(
          `\u0000${page.key}`,
          {
            name: "",
            key: page.key,
            ...(page.path === "" ? {} : { path: page.path }),
          },
          false,
          true,
        );
      }
      const title = activity.title ?? "";
      return title === ""
        ? part("", { name: "(no title)" }, true)
        : part(title, { name: title });
    }
  }
};

/** The non-empty title with the most time across the rows, first seen on a tie. */
const topTitle = (rows: ReadonlyArray<Row>): string => {
  const byTitle = new Map<string, number>();
  for (const row of rows) {
    const title = row.activity.title;
    if (title !== null && title !== "") {
      byTitle.set(title, (byTitle.get(title) ?? 0) + row.ms);
    }
  }
  let top = "";
  let topMs = 0;
  for (const [title, ms] of byTitle) {
    if (ms > topMs) {
      top = title;
      topMs = ms;
    }
  }
  return top === "" ? "(no title)" : top;
};

interface Group {
  readonly line: Line;
  readonly ms: number;
  readonly children: ReadonlyArray<Group>;
}

/** `parent` is false only for the top level, which has no line above it. */
const group = (
  rows: ReadonlyArray<Row>,
  levels: ReadonlyArray<Level>,
  l: Lookups,
  parent: boolean,
): ReadonlyArray<Group> => {
  const [level, ...rest] = levels;
  if (level === undefined) {
    return [];
  }
  const byId = new Map<string, { part: Part; rows: Array<Row> }>();
  for (const row of rows) {
    const part = partOf(level, row, l);
    const found = byId.get(part.id);
    if (found === undefined) {
      byId.set(part.id, { part, rows: [row] });
    } else {
      found.rows.push(row);
    }
  }
  const parts = [...byId.values()];
  // An empty value with no siblings says nothing under its parent: skip the
  // level. At the top there is no parent to carry the time, so it stays.
  if (parent && parts.length === 1 && parts[0]?.part.empty === true) {
    return group(rows, rest, l, parent);
  }
  return parts.map(({ part, rows }) => ({
    line: part.titled ? { ...part.line, name: topTitle(rows) } : part.line,
    ms: rows.reduce((sum, row) => sum + row.ms, 0),
    // A Private line has no detail under it.
    children: part.line.private === true ? [] : group(rows, rest, l, true),
  }));
};

// Each line rounds once. Two or more siblings under `min`
// merge into one line that sorts last; one alone keeps its name.
const finish = (
  groups: ReadonlyArray<Group>,
  min: number,
): ReadonlyArray<BreakdownNode> => {
  const nodes = groups.map((g) => ({
    ms: g.ms,
    node: {
      ...g.line,
      seconds: Math.round(g.ms / 1000),
      children: finish(g.children, min),
    },
  }));
  const small = nodes.filter((n) => n.node.seconds < min);
  const merge = small.length >= 2;
  const kept = (merge ? nodes.filter((n) => n.node.seconds >= min) : nodes)
    .map((n) => n.node)
    .sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name));
  if (!merge) {
    return kept;
  }
  return [
    ...kept,
    {
      name: `${small.length} small items`,
      seconds: Math.round(small.reduce((sum, n) => sum + n.ms, 0) / 1000),
      small: small.length,
      children: [],
    },
  ];
};

type Kind = Schema.Schema.Type<typeof DeviceKind>;

const isKind = (value: string): value is Kind =>
  (DeviceKind.literals as ReadonlyArray<string>).includes(value);

/** The Devices a list of kinds and ids names; an id no Device has fails. */
const pickDevices = (
  asked: ReadonlyArray<string>,
  devices: ReadonlyArray<Device>,
): Effect.Effect<ReadonlyArray<string>, DeviceNotFoundError> => {
  const unknown = asked.find(
    (id) => !isKind(id) && !devices.some((d) => d.id === id),
  );
  return unknown === undefined
    ? Effect.succeed(
        devices
          .filter((d) => asked.includes(d.kind) || asked.includes(d.id))
          .map((d) => d.id),
      )
    : Effect.fail(new DeviceNotFoundError({ id: unknown }));
};

/** One note per iPhone or iPad whose data ends before the window does. */
const lateNotes = (
  store: Store,
  devices: ReadonlyArray<Device>,
  to: DateTime.Utc,
): Effect.Effect<ReadonlyArray<string>, StoreError, DateTime.CurrentTimeZone> =>
  Effect.gen(function* () {
    const zone = yield* DateTime.CurrentTimeZone;
    const notes: Array<string> = [];
    for (const device of devices) {
      if (device.kind === "mac") {
        continue;
      }
      const upTo = yield* dataUpTo(store, device);
      if (Option.isSome(upTo) && DateTime.lessThan(upTo.value, to)) {
        const at = isoMinute(DateTime.setZone(upTo.value, zone));
        notes.push(
          `${device.name} data up to ${at.replace("T", " ")}; later time is not in yet`,
        );
      }
    }
    return notes;
  });

// Local wall clock plus offset, so the two 01:00 hours of the day DST ends differ.
const stamp = (ms: number, zone: DateTime.TimeZone): string => {
  const zoned = DateTime.setZone(DateTime.unsafeMake(ms), zone);
  return `${isoMinute(zoned)}${DateTime.zonedOffsetIso(zoned)}`;
};

const stepMinutes = { hour: 60, "15min": 15 } as const;

// Block edges on the local clock. Every zone's offset is a whole number of
// quarter-hours, so each clock quarter-hour is a UTC quarter-hour: walk those
// and keep the ones whose local minute is on the step. A DST jump of an hour
// or of 30 minutes then still lands on the clock.
const edges = (
  fromMs: number,
  toMs: number,
  size: BlockSize,
  zone: DateTime.TimeZone,
): ReadonlyArray<number> => {
  // An empty window is one empty Block in every size, as it is in total.
  if (size === "total" || fromMs >= toMs) {
    return [fromMs, toMs];
  }
  const minutes = stepMinutes[size];
  const quarter = 15 * 60_000;
  const out = [fromMs];
  for (
    let t = Math.floor(fromMs / quarter) * quarter + quarter;
    t < toMs;
    t += quarter
  ) {
    const local = DateTime.toParts(
      DateTime.setZone(DateTime.unsafeMake(t), zone),
    );
    if (local.minutes % minutes === 0) {
      out.push(t);
    }
  }
  out.push(toMs);
  return out;
};

/** The index of the Block that holds `ms`: the last edge at or before it. */
const blockIndex = (edges: ReadonlyArray<number>, ms: number): number => {
  let lo = 0;
  let hi = edges.length - 2;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if ((edges[mid] ?? 0) <= ms) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
};

// An Activity across an edge is cut there; a zero-length one stays in the
// Block of its start.
const cut = (
  rows: ReadonlyArray<Row>,
  edges: ReadonlyArray<number>,
): ReadonlyArray<ReadonlyArray<Row>> => {
  const buckets = edges.slice(1).map((): Array<Row> => []);
  const fromMs = edges[0] ?? 0;
  const toMs = edges[edges.length - 1] ?? 0;
  for (const row of rows) {
    const start = Math.max(row.activity.startedAt.epochMillis, fromMs);
    const end = Math.min(row.activity.endedAt.epochMillis, toMs);
    let i = blockIndex(edges, start);
    if (end <= start) {
      buckets[i]?.push({ ...row, ms: 0 });
      continue;
    }
    for (; i < buckets.length && (edges[i] ?? 0) < end; i++) {
      const ms =
        Math.min(end, edges[i + 1] ?? 0) - Math.max(start, edges[i] ?? 0);
      if (ms > 0) {
        buckets[i]?.push({ ...row, ms });
      }
    }
  }
  return buckets;
};

const blockOf = (
  startMs: number,
  endMs: number,
  rows: ReadonlyArray<Row>,
  levels: ReadonlyArray<Level>,
  min: number,
  lookups: Lookups,
  zone: DateTime.TimeZone,
): BreakdownBlock => {
  const ms = rows.reduce((sum, row) => sum + row.ms, 0);
  // A reduce, not a spread: a year of rows is past the argument limit.
  const first = rows.reduce(
    (earliest, row) =>
      Math.min(earliest, Math.max(row.activity.startedAt.epochMillis, startMs)),
    Number.POSITIVE_INFINITY,
  );
  const last = rows.reduce(
    (latest, row) =>
      Math.max(latest, Math.min(row.activity.endedAt.epochMillis, endMs)),
    Number.NEGATIVE_INFINITY,
  );
  return {
    start: stamp(startMs, zone),
    end: stamp(endMs, zone),
    ...(rows.length === 0
      ? {}
      : { first: stamp(first, zone), last: stamp(last, zone) }),
    seconds: Math.round(ms / 1000),
    nodes: finish(group(rows, levels, lookups, false), min),
  };
};

export const breakdown = (
  input: Schema.Schema.Encoded<typeof BreakdownInput>,
): Effect.Effect<
  BreakdownReply,
  InvalidInputError | InvalidRangeError | DeviceNotFoundError | StoreError,
  Store | AppStore | DateTime.CurrentTimeZone
> =>
  Effect.gen(function* () {
    const decoded = yield* decodeInput(BreakdownInput)(input);
    const store = yield* Store;
    const asked = decoded.devices;
    const deviceIds =
      asked === undefined
        ? undefined
        : yield* pickDevices(asked, yield* store.listDevices());
    const zone = yield* DateTime.CurrentTimeZone;
    const loaded = yield* loadRange({ range: decoded.range, deviceIds });
    const { range, from, to, categories, projects, devices } = loaded;
    const search = decoded.search;
    const rows =
      search === undefined
        ? loaded.rows
        : loaded.rows.filter((row) => matches(row, search));
    const lookups: Lookups = {
      categoryById: new Map(categories.map((c) => [c.id, c])),
      projectById: new Map(projects.map((p) => [p.id, p])),
      deviceById: new Map(devices.map((d) => [d.id, d])),
    };
    const blockEdges = edges(
      from.epochMillis,
      to.epochMillis,
      decoded.block,
      zone,
    );
    // A run of Blocks with no activity is one Block from the first start to
    // the last end.
    const spans: Array<{
      startMs: number;
      endMs: number;
      rows: ReadonlyArray<Row>;
    }> = [];
    cut(rows, blockEdges).forEach((blockRows, i) => {
      const endMs = blockEdges[i + 1] ?? 0;
      const last = spans[spans.length - 1];
      if (
        blockRows.length === 0 &&
        last !== undefined &&
        last.rows.length === 0
      ) {
        last.endMs = endMs;
      } else {
        spans.push({ startMs: blockEdges[i] ?? 0, endMs, rows: blockRows });
      }
    });
    const blocks = spans.map((span) =>
      blockOf(
        span.startMs,
        span.endMs,
        span.rows,
        decoded.groupBy,
        decoded.min,
        lookups,
        zone,
      ),
    );
    // Before search: a kind whose Activities only miss the word still has activity.
    const kindNotes = [...new Set(asked ?? [])]
      .filter(isKind)
      .filter(
        (kind) =>
          !loaded.rows.some(
            (row) =>
              lookups.deviceById.get(row.activity.deviceId)?.kind === kind,
          ),
      )
      .map((kind) => `no ${kind} Device has activity in this range`);
    const late = yield* lateNotes(
      store,
      deviceIds === undefined
        ? devices
        : devices.filter((d) => deviceIds.includes(d.id)),
      loaded.to,
    );
    return {
      range,
      blocks,
      notes: [
        ...late,
        ...(rows.length === 0 && kindNotes.length === 0
          ? ["no activity in this range"]
          : kindNotes),
      ],
    };
  });

export type Level = Schema.Schema.Type<typeof Level>;
export type BlockSize = Schema.Schema.Type<typeof BlockSize>;
export type BreakdownBlock = Schema.Schema.Type<typeof BreakdownBlock>;
export type BreakdownReply = Schema.Schema.Type<typeof BreakdownReply>;
export type BreakdownInput = Schema.Schema.Type<typeof BreakdownInput>;
