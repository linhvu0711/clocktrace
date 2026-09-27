import { type DateTime, Effect, Schema } from "effect";

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
import type { Project } from "./project.js";
import { Range, UsedRange } from "./range.js";
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
).annotations({
  message: () => ({
    message: "must be one of category, project, device, app, domain, title",
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
  "title",
];

const nodeFields = {
  name: Schema.String,
  seconds: Schema.Int,
  /** The Device, bundle, Category, or Project id behind the line. */
  key: Schema.optionalWith(Schema.String, { exact: true }),
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
  devices: Schema.optional(
    Schema.Array(DeviceSelector).pipe(
      Schema.minItems(1, { message: () => "must name at least one Device" }),
    ),
  ),
});

type Row = RangeRows["rows"][number];

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
}

// No domain or title holds a NUL, so a Private line never merges with a real value.
const privateId = "\u0000private";

const partOf = (level: Level, { activity, resolution }: Row, l: Lookups) => {
  const part = (id: string, line: Line, empty = false): Part => ({
    id,
    line,
    empty,
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
  }
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
    line: part.line,
    ms: rows.reduce((sum, row) => sum + row.ms, 0),
    // A Private line has no detail under it.
    children: part.line.private === true ? [] : group(rows, rest, l, true),
  }));
};

// Each line rounds once, as summary does. Two or more siblings under `min`
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
    const { range, rows, categories, projects, devices } = yield* loadRange({
      range: decoded.range,
      deviceIds,
    });
    const lookups: Lookups = {
      categoryById: new Map(categories.map((c) => [c.id, c])),
      projectById: new Map(projects.map((p) => [p.id, p])),
      deviceById: new Map(devices.map((d) => [d.id, d])),
    };
    const nodes = finish(
      group(rows, decoded.groupBy, lookups, false),
      decoded.min,
    );
    const ms = rows.reduce((sum, row) => sum + row.ms, 0);
    const kindNotes = [...new Set(asked ?? [])]
      .filter(isKind)
      .filter(
        (kind) =>
          !rows.some(
            (row) =>
              lookups.deviceById.get(row.activity.deviceId)?.kind === kind,
          ),
      )
      .map((kind) => `no ${kind} Device has activity in this range`);
    return {
      range,
      blocks: [{ seconds: Math.round(ms / 1000), nodes }],
      notes:
        nodes.length === 0 && kindNotes.length === 0
          ? ["no activity in this range"]
          : kindNotes,
    };
  });

export type Level = Schema.Schema.Type<typeof Level>;
export type BreakdownBlock = Schema.Schema.Type<typeof BreakdownBlock>;
export type BreakdownReply = Schema.Schema.Type<typeof BreakdownReply>;
export type BreakdownInput = Schema.Schema.Type<typeof BreakdownInput>;
