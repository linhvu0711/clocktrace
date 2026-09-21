import { type DateTime, Effect, type Option } from "effect";
import type { ParseError } from "effect/ParseResult";

import type { Activity, NewActivity } from "./activity.js";
import type { Category, NewCategory } from "./category.js";
import type { Device, NewDevice } from "./device.js";
import type { StoreError } from "./errors.js";
import type { NewProject, Project } from "./project.js";
import type { NewRule, Rule } from "./rule.js";
import { openStore } from "./sqlite-store.js";

export interface StoreShape {
  readonly getOrInsertDevice: (
    input: NewDevice,
  ) => Effect.Effect<Device, ParseError | StoreError>;
  readonly listDevices: () => Effect.Effect<ReadonlyArray<Device>, StoreError>;
  readonly insertActivity: (
    input: NewActivity,
  ) => Effect.Effect<Activity, ParseError | StoreError>;
  readonly readActivities: (query: {
    readonly deviceId?: string | undefined;
    readonly from: DateTime.Utc;
    readonly to: DateTime.Utc;
  }) => Effect.Effect<ReadonlyArray<Activity>, StoreError>;
  readonly insertCategory: (
    input: NewCategory,
  ) => Effect.Effect<Category, ParseError | StoreError>;
  readonly listCategories: () => Effect.Effect<
    ReadonlyArray<Category>,
    StoreError
  >;
  readonly updateCategory: (
    id: string,
    input: NewCategory,
  ) => Effect.Effect<Option.Option<Category>, ParseError | StoreError>;
  readonly insertProject: (
    input: NewProject,
  ) => Effect.Effect<Project, ParseError | StoreError>;
  readonly listProjects: () => Effect.Effect<
    ReadonlyArray<Project>,
    StoreError
  >;
  readonly updateProject: (
    id: string,
    input: NewProject,
  ) => Effect.Effect<Option.Option<Project>, ParseError | StoreError>;
  readonly insertRule: (
    input: NewRule,
  ) => Effect.Effect<Rule, ParseError | StoreError>;
  readonly insertRuleIfAbsent: (
    input: Omit<NewRule, "position">,
  ) => Effect.Effect<Rule, ParseError | StoreError>;
  readonly listRules: () => Effect.Effect<ReadonlyArray<Rule>, StoreError>;
  readonly deleteRule: (id: string) => Effect.Effect<boolean, StoreError>;
  readonly deleteCategory: (id: string) => Effect.Effect<boolean, StoreError>;
  readonly deleteProject: (id: string) => Effect.Effect<boolean, StoreError>;
  readonly getSetting: (
    key: string,
  ) => Effect.Effect<Option.Option<string>, StoreError>;
  readonly setSetting: (
    key: string,
    value: string,
  ) => Effect.Effect<void, StoreError>;
  /**
   * Writes the Starter set and its flag in one transaction. Does nothing
   * when the flag is already set. A write that fails leaves nothing behind.
   */
  readonly seedStarterSet: () => Effect.Effect<void, StoreError>;
}

export class Store extends Effect.Service<Store>()("Store", {
  scoped: (path: string) =>
    Effect.tap(openStore(path), (store) => store.seedStarterSet()),
}) {
  // biome-ignore lint/style/useNamingConvention: layers are PascalCase
  static Test = this.Default(":memory:");
}
