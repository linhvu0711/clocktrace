import { isoMinute } from "@clocktrace/core";
import { Terminal } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Ansi, AnsiDoc } from "@effect/printer-ansi";
import { Config, DateTime, Effect, Layer, Option } from "effect";
import stringWidth from "string-width";

export type Tone = "ok" | "warn" | "bad" | "dim" | "head";

export type Span = { readonly text: string; readonly tone?: Tone };

export type Cell = string | Span | ReadonlyArray<string | Span>;

export type Look = { readonly color: boolean; readonly unicode: boolean };

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

export const columns = (
  rows: ReadonlyArray<ReadonlyArray<Cell>>,
  look: Look,
): ReadonlyArray<string> => {
  const widthAt = (i: number): number =>
    Math.max(...rows.map((r) => visible(r[i] ?? ""))) + 2;
  return rows.map((r) =>
    r
      .map((cell, i) => {
        const rendered = spans(cell)
          .map((s) => renderSpan(s, look))
          .join("");
        return i < r.length - 1
          ? rendered + " ".repeat(widthAt(i) - visible(cell))
          : rendered;
      })
      .join(""),
  );
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
    const noColor = yield* Effect.orDie(
      Config.option(Config.string("NO_COLOR")),
    );
    const term = yield* Effect.orDie(Config.option(Config.string("TERM")));
    return {
      color: colorEnabled(isTTY, noColor),
      unicode: unicodeEnabled(term),
    };
  }),
  dependencies: [NodeContext.layer],
}) {
  // biome-ignore lint/style/useNamingConvention: layers are PascalCase
  static Test = Layer.succeed(this, new Style({ color: false, unicode: true }));
}
