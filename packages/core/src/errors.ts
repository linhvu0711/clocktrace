import { Data } from "effect";

export class StoreError extends Data.TaggedError("StoreError")<{
  readonly cause: unknown;
}> {}

export class DatabaseNewerError extends Data.TaggedError("DatabaseNewerError")<{
  readonly fileVersion: number;
  readonly codeVersion: number;
}> {
  override get message(): string {
    return "database is newer than this clocktrace";
  }
}
