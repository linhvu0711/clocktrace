import { Data, Either } from "effect";
import {
  isMap,
  isScalar,
  type Node,
  type Pair,
  parseDocument,
  stringify,
  type YAMLMap,
} from "yaml";

// Edits the Registration in Hermes' config.yaml as text: the parse only
// finds where it sits, and every byte outside it stays as the user wrote it.

export interface HermesServer {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

export class HermesConfigEditError extends Data.TaggedError(
  "HermesConfigEditError",
)<{
  readonly reason: string;
}> {
  override get message(): string {
    return `cannot edit ~/.hermes/config.yaml: ${this.reason}`;
  }
}

const serversKey = "mcp_servers";
const registrationKey = "clocktrace";
const defaultStep = 2;

// Hermes reads the file with PyYAML, a YAML 1.1 reader, so the emitted
// lines quote what 1.1 would read as another type (`yes`, `1:2`).
const blockLines = (
  value: Record<string, unknown>,
  step: number,
  indent: number,
): ReadonlyArray<string> =>
  stringify(value, { indent: step, lineWidth: 0, version: "1.1" })
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => " ".repeat(indent) + line);

const lineEnd = (text: string): string =>
  text.includes("\r\n") ? "\r\n" : "\n";

const lineStart = (text: string, offset: number): number =>
  text.lastIndexOf("\n", offset - 1) + 1;

const column = (text: string, offset: number): number =>
  offset - lineStart(text, offset);

// The offset just past the line end that follows the last non-space
// character before `end`: a node's range can reach into the next line.
const lineAfter = (text: string, end: number): number => {
  let last = end;
  while (last > 0 && /\s/.test(text.charAt(last - 1))) {
    last--;
  }
  const eol = text.indexOf("\n", last);
  return eol === -1 ? text.length : eol + 1;
};

const nodeStart = (node: unknown): number =>
  (node as Node | null)?.range?.[0] ?? 0;

const nodeEnd = (node: unknown): number =>
  (node as Node | null)?.range?.[2] ?? 0;

// Swaps the whole lines from `from` to `to` for `lines`. A text without a
// final line end keeps none, so a later removal can give the same text back.
const spliceLines = (
  text: string,
  from: number,
  to: number,
  lines: ReadonlyArray<string>,
  eol: string,
): string => {
  const body = lines.join(eol);
  if (from === text.length) {
    return text === "" || text.endsWith("\n")
      ? text + body + eol
      : text + eol + body;
  }
  const ending = to === text.length && !text.endsWith("\n") ? "" : eol;
  return text.slice(0, from) + body + ending + text.slice(to);
};

const findPair = (
  map: YAMLMap,
  key: string,
): Pair<unknown, unknown> | undefined =>
  map.items.find((pair) => isScalar(pair.key) && pair.key.value === key);

// The file's own indent step: the first block map under a top-level key,
// `mcp_servers` first, measured from its parent key.
const indentStep = (text: string, root: YAMLMap): number => {
  const servers = findPair(root, serversKey);
  const pairs = servers === undefined ? root.items : [servers, ...root.items];
  for (const pair of pairs) {
    const value = pair.value;
    if (isMap(value) && !value.flow && value.items.length > 0) {
      const step =
        column(text, nodeStart(value.items[0]?.key)) -
        column(text, nodeStart(pair.key));
      if (step > 0) {
        return step;
      }
    }
  }
  return defaultStep;
};

const registrationEntry = (
  server: HermesServer,
  old: unknown,
): Record<string, unknown> => {
  const env = isMap(old) ? old.get("env", true) : undefined;
  return {
    command: server.command,
    args: [...server.args],
    ...(isMap(env) ? { env: env.toJSON() } : {}),
  };
};

export const setRegistration = (
  text: string,
  server: HermesServer,
): Either.Either<string, HermesConfigEditError> => {
  const doc = parseDocument(text);
  const eol = lineEnd(text);
  const root = doc.contents;
  if (root === null) {
    const entry = registrationEntry(server, undefined);
    return Either.right(
      spliceLines(
        text,
        text.length,
        text.length,
        blockLines(
          { [serversKey]: { [registrationKey]: entry } },
          defaultStep,
          0,
        ),
        eol,
      ),
    );
  }
  if (!isMap(root)) {
    return Either.left(
      new HermesConfigEditError({ reason: "the top level is not a map" }),
    );
  }
  const step = indentStep(text, root);
  const serversPair = findPair(root, serversKey);
  if (serversPair === undefined) {
    const entry = registrationEntry(server, undefined);
    return Either.right(
      spliceLines(
        text,
        text.length,
        text.length,
        blockLines(
          { [serversKey]: { [registrationKey]: entry } },
          step,
          column(text, nodeStart(root.items[0]?.key)),
        ),
        eol,
      ),
    );
  }
  const servers = serversPair.value;
  if (isMap(servers) && !servers.flow && servers.items.length > 0) {
    const old = findPair(servers, registrationKey);
    const lines = blockLines(
      { [registrationKey]: registrationEntry(server, old?.value) },
      step,
      column(text, nodeStart(servers.items[0]?.key)),
    );
    if (old !== undefined) {
      const from = lineStart(text, nodeStart(old.key));
      const to = lineAfter(
        text,
        Math.max(nodeEnd(old.key), nodeEnd(old.value)),
      );
      return Either.right(spliceLines(text, from, to, lines, eol));
    }
    const last = servers.items[servers.items.length - 1];
    const at = lineAfter(
      text,
      Math.max(nodeEnd(last?.key), nodeEnd(last?.value)),
    );
    return Either.right(spliceLines(text, at, at, lines, eol));
  }
  return Either.left(
    new HermesConfigEditError({ reason: "mcp_servers is not a block map" }),
  );
};
