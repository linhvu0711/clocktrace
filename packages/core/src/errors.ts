import { Data } from "effect";

export class StoreError extends Data.TaggedError("StoreError")<{
  readonly cause: unknown;
}> {}

export class InvalidRuleError extends Data.TaggedError("InvalidRuleError")<{
  readonly field: "value" | "target";
  readonly reason: string;
}> {
  override get message(): string {
    return `${this.field}: ${this.reason}`;
  }
}

export class RuleNotFoundError extends Data.TaggedError("RuleNotFoundError")<{
  readonly id: string;
}> {
  override get message(): string {
    return `rule ${this.id} not found`;
  }
}

export class InvalidRangeError extends Data.TaggedError("InvalidRangeError")<{
  readonly field: "range";
  readonly reason: string;
}> {
  override get message(): string {
    return `${this.field}: ${this.reason}`;
  }
}

export class DatabaseNewerError extends Data.TaggedError("DatabaseNewerError")<{
  readonly fileVersion: number;
  readonly codeVersion: number;
}> {
  override get message(): string {
    return "database is newer than this clocktrace";
  }
}
