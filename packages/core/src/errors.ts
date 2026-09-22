import { Data } from "effect";

export class StoreError extends Data.TaggedError("StoreError")<{
  readonly cause: unknown;
}> {}

export class AppStoreError extends Data.TaggedError("AppStoreError")<{
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

export class CategoryNotFoundError extends Data.TaggedError(
  "CategoryNotFoundError",
)<{
  readonly id: string;
}> {
  override get message(): string {
    return `category ${this.id} not found`;
  }
}

export class ProjectNotFoundError extends Data.TaggedError(
  "ProjectNotFoundError",
)<{
  readonly id: string;
}> {
  override get message(): string {
    return `project ${this.id} not found`;
  }
}

export class CategoryInUseError extends Data.TaggedError("CategoryInUseError")<{
  readonly id: string;
  readonly count: number;
}> {
  override get message(): string {
    return `category ${this.id} is used by ${this.count} rules, remove them first`;
  }
}

export class ProjectInUseError extends Data.TaggedError("ProjectInUseError")<{
  readonly id: string;
  readonly count: number;
}> {
  override get message(): string {
    return `project ${this.id} is used by ${this.count} rules, remove them first`;
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
    return `database was written by clocktrace ${this.fileVersion}, this is ${this.codeVersion} · upgrade clocktrace`;
  }
}
