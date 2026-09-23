import { isDeepStrictEqual } from "node:util";

import { Data, Either, Option } from "effect";
import {
  type Document,
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

// Cuts the whole lines from `from` to `to`. A cut that reaches the end of
// a text without a final line end takes the line end before it too, which
// undoes what `spliceLines` added.
const cutLines = (text: string, from: number, to: number): string => {
  if (to === text.length && !text.endsWith("\n") && from > 0) {
    const eolLength = text.slice(0, from).endsWith("\r\n") ? 2 : 1;
    return text.slice(0, from - eolLength);
  }
  return text.slice(0, from) + text.slice(to);
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

const refuse = (reason: string) =>
  Either.left(new HermesConfigEditError({ reason }));

// Plain data from the parse. It throws on an alias whose anchor is gone,
// which the check meets when an edit takes an anchor with it.
const toData = (
  convert: () => unknown,
): Either.Either<unknown, HermesConfigEditError> =>
  Either.try({
    try: convert,
    catch: () =>
      new HermesConfigEditError({ reason: "an alias has no anchor" }),
  });

// The parsed file as plain data, an empty file read as an empty map.
const plain = (doc: Document): Either.Either<unknown, HermesConfigEditError> =>
  toData(() => (doc.contents === null ? {} : doc.toJSON()));

const registrationEntry = (
  server: HermesServer,
  old: unknown,
): Either.Either<Record<string, unknown>, HermesConfigEditError> => {
  const env = isMap(old) ? old.get("env", true) : undefined;
  const base = { command: server.command, args: [...server.args] };
  return isMap(env)
    ? toData(() => env.toJSON()).pipe(
        Either.map((data) => ({ ...base, env: data })),
      )
    : Either.right(base);
};

// The data minus the Registration, and minus `mcp_servers` when that
// leaves it empty, so a file before and after an edit compare equal.
const withoutRegistration = (data: unknown): unknown => {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return data;
  }
  const { [serversKey]: servers, ...rest } = data as Record<string, unknown>;
  if (servers === null || servers === undefined) {
    return rest;
  }
  if (typeof servers !== "object" || Array.isArray(servers)) {
    return { ...rest, [serversKey]: servers };
  }
  const { [registrationKey]: _, ...others } = servers as Record<
    string,
    unknown
  >;
  return Object.keys(others).length === 0
    ? rest
    : { ...rest, [serversKey]: others };
};

const registrationOf = (data: unknown): unknown =>
  (data as Record<string, Record<string, unknown> | undefined> | null)?.[
    serversKey
  ]?.[registrationKey];

// Parses the edited text again: it must hold `registration` (undefined
// for none) and everything else the original held.
const checkEdit = (
  before: Document,
  after: string,
  registration: unknown,
): Either.Either<string, HermesConfigEditError> => {
  const doc = parseDocument(after);
  if (doc.errors.length > 0) {
    return refuse("the edited file does not parse");
  }
  return Either.all([plain(doc), plain(before)]).pipe(
    Either.flatMap(([data, original]) =>
      isDeepStrictEqual(registrationOf(data), registration) &&
      isDeepStrictEqual(
        withoutRegistration(data),
        withoutRegistration(original),
      )
        ? Either.right(after)
        : refuse("the edited file does not hold what it should"),
    ),
  );
};

const placeRegistration = (
  text: string,
  doc: Document,
  entry: Record<string, unknown>,
): Either.Either<string, HermesConfigEditError> => {
  const eol = lineEnd(text);
  const root = doc.contents;
  const newServers = (step: number, indent: number) =>
    blockLines({ [serversKey]: { [registrationKey]: entry } }, step, indent);
  if (root === null) {
    return Either.right(
      spliceLines(
        text,
        text.length,
        text.length,
        newServers(defaultStep, 0),
        eol,
      ),
    );
  }
  if (!isMap(root)) {
    return refuse("the top level is not a map");
  }
  if (root.flow) {
    if (root.items.length > 0) {
      return refuse("the top level is a one-line map");
    }
    const from = lineStart(text, nodeStart(root));
    const to = lineAfter(text, nodeEnd(root));
    return Either.right(
      spliceLines(text, from, to, newServers(defaultStep, 0), eol),
    );
  }
  const step = indentStep(text, root);
  const serversPair = findPair(root, serversKey);
  if (serversPair === undefined) {
    return Either.right(
      spliceLines(
        text,
        text.length,
        text.length,
        newServers(step, column(text, nodeStart(root.items[0]?.key))),
        eol,
      ),
    );
  }
  const servers = serversPair.value;
  const keyColumn = column(text, nodeStart(serversPair.key));
  const emptyServers =
    (isScalar(servers) && servers.value === null) ||
    (isMap(servers) && servers.flow && servers.items.length === 0);
  if (emptyServers) {
    // `mcp_servers: {}` or `~` becomes `mcp_servers:`, and the
    // Registration goes on the lines below it.
    const keyEnd = (serversPair.key as Node).range?.[1] ?? 0;
    const valueEnd = (servers as Node).range?.[1] ?? keyEnd;
    const cleared = `${text.slice(0, keyEnd)}:${text.slice(valueEnd)}`;
    const at = lineAfter(cleared, keyEnd + 1);
    const lines = blockLines(
      { [registrationKey]: entry },
      step,
      keyColumn + step,
    );
    return Either.right(spliceLines(cleared, at, at, lines, eol));
  }
  if (!isMap(servers) || servers.flow) {
    return refuse("mcp_servers is not a block map");
  }
  const lines = blockLines(
    { [registrationKey]: entry },
    step,
    column(text, nodeStart(servers.items[0]?.key)),
  );
  const old = findPair(servers, registrationKey);
  if (old !== undefined) {
    const from = lineStart(text, nodeStart(old.key));
    const to = lineAfter(text, Math.max(nodeEnd(old.key), nodeEnd(old.value)));
    return Either.right(spliceLines(text, from, to, lines, eol));
  }
  const last = servers.items[servers.items.length - 1];
  const at = lineAfter(
    text,
    Math.max(nodeEnd(last?.key), nodeEnd(last?.value)),
  );
  return Either.right(spliceLines(text, at, at, lines, eol));
};

export const setRegistration = (
  text: string,
  server: HermesServer,
): Either.Either<string, HermesConfigEditError> => {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    return refuse(doc.errors[0]?.message ?? "the file does not parse");
  }
  const old = doc.getIn([serversKey, registrationKey], true);
  return registrationEntry(server, old).pipe(
    Either.flatMap((entry) =>
      placeRegistration(text, doc, entry).pipe(
        Either.flatMap((after) => checkEdit(doc, after, entry)),
      ),
    ),
  );
};

// `None` when the file holds no Registration.
export const removeRegistration = (
  text: string,
): Either.Either<Option.Option<string>, HermesConfigEditError> => {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    return refuse(doc.errors[0]?.message ?? "the file does not parse");
  }
  const root = doc.contents;
  if (root === null) {
    return Either.right(Option.none());
  }
  if (!isMap(root)) {
    return refuse("the top level is not a map");
  }
  const serversPair = findPair(root, serversKey);
  const servers = serversPair?.value;
  if (
    serversPair === undefined ||
    (isScalar(servers) && servers.value === null)
  ) {
    return Either.right(Option.none());
  }
  if (!isMap(servers)) {
    return refuse("mcp_servers is not a map");
  }
  const old = findPair(servers, registrationKey);
  if (old === undefined) {
    return Either.right(Option.none());
  }
  if (servers.flow) {
    return refuse("mcp_servers is a one-line map");
  }
  // The last server takes the `mcp_servers:` line with it, unless a
  // comment sits between the two.
  const between = text.slice(
    lineAfter(text, nodeEnd(serversPair.key)),
    lineStart(text, nodeStart(old.key)),
  );
  const pair =
    servers.items.length === 1 && between.trim() === "" ? serversPair : old;
  const from = lineStart(text, nodeStart(pair.key));
  const to = lineAfter(text, Math.max(nodeEnd(pair.key), nodeEnd(pair.value)));
  return checkEdit(doc, cutLines(text, from, to), undefined).pipe(
    Either.map(Option.some),
  );
};
