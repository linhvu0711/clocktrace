import { isoMinute } from "@clocktrace/core";
import { Terminal } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Ansi, AnsiDoc } from "@effect/printer-ansi";
import { Config, DateTime, Effect, Layer, Option } from "effect";
import stringWidth from "string-width";

export type Tone = "ok" | "warn" | "bad" | "dim" | "head";

export type Span = { readonly text: string; readonly tone?: Tone };

export type Cell = string | Span | ReadonlyArray<string | Span>;

export type Look = {
  readonly color: boolean;
  readonly unicode: boolean;
  /** Terminal columns; 0 when stdout is not a TTY, and nothing is cut. */
  readonly width: number;
};

export type ColumnsOptions = {
  /**
   * What to do with a last cell wider than the room `Look.width` leaves:
   * cut it with an ellipsis (the default), or wrap it onto lines indented
   * to the column's start.
   */
  readonly overflow?: "truncate" | "wrap";
};

const ansi: Record<Tone, Ansi.Ansi> = {
  ok: Ansi.green,
  warn: Ansi.yellow,
  bad: Ansi.red,
  dim: Ansi.blackBright,
  head: Ansi.bold,
};

export const colorEnabled = (
  isTTY: boolean,
  noColor: Option.Option<string>,
): boolean => isTTY && !Option.exists(noColor, (v) => v !== "");

export const unicodeEnabled = (term: Option.Option<string>): boolean =>
  !Option.exists(term, (t) => t === "linux");

export const span = (tone: Tone, text: string): Span => ({ text, tone });

export const mark = (tone: "ok" | "warn" | "bad", look: Look): Span => {
  const text = look.unicode
    ? tone === "ok"
      ? "✔"
      : tone === "warn"
        ? "○"
        : "✘"
    : tone === "ok"
      ? "ok"
      : tone === "warn"
        ? "--"
        : "x";
  return { text, tone };
};

const renderSpan = (s: Span, look: Look): string =>
  look.color && s.tone !== undefined
    ? AnsiDoc.render(AnsiDoc.annotate(AnsiDoc.text(s.text), ansi[s.tone]), {
        style: "pretty",
      })
    : s.text;

const spans = (cell: Cell): ReadonlyArray<Span> =>
  typeof cell === "string"
    ? [{ text: cell }]
    : "text" in cell
      ? [cell]
      : cell.map((c) => (typeof c === "string" ? { text: c } : c));

export const line = (cells: ReadonlyArray<Cell>, look: Look): string =>
  cells
    .flatMap((cell) => spans(cell))
    .map((s) => renderSpan(s, look))
    .join("");

export const shortPath = (path: string, home: string): string =>
  path === home
    ? "~"
    : path.startsWith(`${home}/`)
      ? `~${path.slice(home.length)}`
      : path;

const visible = (cell: Cell): number =>
  spans(cell).reduce((n, s) => n + stringWidth(s.text), 0);

type Grapheme = {
  readonly text: string;
  readonly tone: Tone | undefined;
  readonly width: number;
};

const segmenter = new Intl.Segmenter();

const graphemes = (cell: Cell): ReadonlyArray<Grapheme> =>
  spans(cell).flatMap((s) =>
    Array.from(segmenter.segment(s.text), ({ segment }) => ({
      text: segment,
      tone: s.tone,
      width: stringWidth(segment),
    })),
  );

const regroup = (gs: ReadonlyArray<Grapheme>): ReadonlyArray<Span> => {
  const out: Array<Span> = [];
  for (const g of gs) {
    const last = out[out.length - 1];
    if (last !== undefined && last.tone === g.tone) {
      out[out.length - 1] = { ...last, text: last.text + g.text };
    } else {
      out.push(
        g.tone === undefined
          ? { text: g.text }
          : { text: g.text, tone: g.tone },
      );
    }
  }
  return out;
};

const take = (
  gs: ReadonlyArray<Grapheme>,
  room: number,
): ReadonlyArray<Grapheme> => {
  const out: Array<Grapheme> = [];
  let used = 0;
  for (const g of gs) {
    if (used + g.width > room) {
      break;
    }
    out.push(g);
    used += g.width;
  }
  return out;
};

const cut = (cell: Cell, room: number, look: Look): ReadonlyArray<Span> => {
  const ellipsis = look.unicode ? "…" : "...";
  const e = stringWidth(ellipsis);
  const gs = graphemes(cell);
  return e > room
    ? regroup(take(gs, room))
    : [...regroup(take(gs, room - e)), { text: ellipsis }];
};

const widthOf = (gs: ReadonlyArray<Grapheme>): number =>
  gs.reduce((n, g) => n + g.width, 0);

/** Splits at spaces; a run of spaces is one break and the spaces are dropped. */
const tokens = (
  gs: ReadonlyArray<Grapheme>,
): ReadonlyArray<ReadonlyArray<Grapheme>> => {
  const out: Array<Array<Grapheme>> = [];
  let open: Array<Grapheme> = [];
  for (const g of gs) {
    if (g.text !== " ") {
      open.push(g);
    } else if (open.length > 0) {
      out.push(open);
      open = [];
    }
  }
  return open.length > 0 ? [...out, open] : out;
};

const wrap = (cell: Cell, room: number): ReadonlyArray<ReadonlyArray<Span>> => {
  const lines: Array<ReadonlyArray<Grapheme>> = [];
  let open: Array<Grapheme> = [];
  let openWidth = 0;
  const flush = () => {
    if (open.length > 0) {
      lines.push(open);
      open = [];
      openWidth = 0;
    }
  };
  for (const token of tokens(graphemes(cell))) {
    const w = widthOf(token);
    if (w > room) {
      flush();
      let rest = token;
      while (rest.length > 0) {
        const chunk = take(rest, room);
        const piece = chunk.length > 0 ? chunk : rest.slice(0, 1);
        lines.push(piece);
        rest = rest.slice(piece.length);
      }
    } else if (open.length === 0) {
      open = [...token];
      openWidth = w;
    } else if (openWidth + 1 + w <= room) {
      const first = token[0];
      open.push({ text: " ", tone: first?.tone, width: 1 }, ...token);
      openWidth += 1 + w;
    } else {
      flush();
      open = [...token];
      openWidth = w;
    }
  }
  flush();
  return lines.map(regroup);
};

export const columns = (
  rows: ReadonlyArray<ReadonlyArray<Cell>>,
  look: Look,
  options: ColumnsOptions = {},
): ReadonlyArray<string> => {
  const widest = (i: number): number =>
    Math.max(...rows.map((r) => visible(r[i] ?? "")));
  const render = (ss: ReadonlyArray<Span>): string =>
    ss.map((s) => renderSpan(s, look)).join("");
  return rows.flatMap((r) => {
    const last = r.length - 1;
    const cell = r[last];
    if (cell === undefined) {
      return [""];
    }
    const lead = r.slice(0, last);
    const start = lead.reduce((n, _, i) => n + widest(i) + 2, 0);
    const head = lead
      .map(
        (c, i) => render(spans(c)) + " ".repeat(widest(i) - visible(c)) + "  ",
      )
      .join("");
    const room = look.width - start;
    if (look.width === 0 || visible(cell) <= room) {
      return [head + render(spans(cell))];
    }
    if (room <= 0) {
      return [head];
    }
    if (options.overflow === "wrap") {
      const [first, ...rest] = wrap(cell, room).map(render);
      return [head + (first ?? ""), ...rest.map((l) => " ".repeat(start) + l)];
    }
    return [head + render(cut(cell, room, look))];
  });
};

export const clock = (t: DateTime.Utc, now: DateTime.Zoned): string => {
  const at = isoMinute(DateTime.setZone(t, now.zone));
  const day = at.slice(0, 10);
  const time = at.slice(11);
  return day === isoMinute(now).slice(0, 10)
    ? `today ${time}`
    : `${day} ${time}`;
};

export const duration = (seconds: number): string => {
  if (seconds < 60) {
    return "<1m";
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h === 0 ? `${m}m ${pad(s)}s` : `${h}h ${pad(m)}m ${pad(s)}s`;
};

export const shortDuration = (seconds: number): string => {
  if (seconds < 60) {
    return "<1m";
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h === 0 ? `${m}m` : `${h}h ${pad(m)}m`;
};

export const count = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`;

export const text = (s: string): string => s.replace(/\p{Cc}/gu, " ");

export class Style extends Effect.Service<Style>()("Style", {
  effect: Effect.gen(function* () {
    const terminal = yield* Terminal.Terminal;
    const isTTY = yield* terminal.isTTY;
    const width = yield* terminal.columns;
    const noColor = yield* Effect.orDie(
      Config.option(Config.string("NO_COLOR")),
    );
    const term = yield* Effect.orDie(Config.option(Config.string("TERM")));
    return {
      color: colorEnabled(isTTY, noColor),
      unicode: unicodeEnabled(term),
      width,
    };
  }),
  dependencies: [NodeContext.layer],
}) {
  // biome-ignore lint/style/useNamingConvention: layers are PascalCase
  static Test = Layer.succeed(
    this,
    new Style({ color: false, unicode: true, width: 0 }),
  );
}
