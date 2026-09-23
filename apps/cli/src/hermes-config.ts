import { Data, Either } from "effect";
import { isMap, parseDocument, stringify } from "yaml";

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

// Puts whole lines at the end of the text. A text without a final line
// end keeps none, so a later removal can give the same text back.
const appendLines = (
  text: string,
  lines: ReadonlyArray<string>,
  eol: string,
): string =>
  text === "" || text.endsWith("\n")
    ? text + lines.join(eol) + eol
    : text + eol + lines.join(eol);

export const setRegistration = (
  text: string,
  server: HermesServer,
): Either.Either<string, HermesConfigEditError> => {
  const doc = parseDocument(text);
  const eol = lineEnd(text);
  const entry = { command: server.command, args: [...server.args] };
  if (doc.contents === null || isMap(doc.contents)) {
    return Either.right(
      appendLines(
        text,
        blockLines(
          { [serversKey]: { [registrationKey]: entry } },
          defaultStep,
          0,
        ),
        eol,
      ),
    );
  }
  return Either.left(
    new HermesConfigEditError({ reason: "the top level is not a map" }),
  );
};
