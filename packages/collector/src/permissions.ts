import { Schema } from "effect";

export const GrantState = Schema.Literal(
  "granted",
  "denied",
  "notAsked",
  "notRunning",
  "noAnswer",
  "notInstalled",
);

export type GrantState = Schema.Schema.Type<typeof GrantState>;

export const Permissions = Schema.parseJson(
  Schema.Struct({
    accessibility: GrantState,
    automation: Schema.Record({ key: Schema.String, value: GrantState }),
    fullDiskAccess: GrantState,
  }),
);

export type Permissions = Schema.Schema.Type<typeof Permissions>;

export const decodePermissions = Schema.decodeUnknown(Permissions);

const browserNames: Record<string, string> = {
  "com.apple.Safari": "Safari",
  "com.brave.Browser": "Brave",
  "com.google.Chrome": "Chrome",
  "com.microsoft.edgemac": "Edge",
  "com.operasoftware.Opera": "Opera",
  "com.vivaldi.Vivaldi": "Vivaldi",
  "org.chromium.Chromium": "Chromium",
};

export const browserName = (bundleId: string): string =>
  browserNames[bundleId] ?? bundleId;

export const noAnswerNote = (browser: string): string =>
  `${browser} did not answer · quit ${browser}, open it again, then run clocktrace permissions`;

export const GrantRequest = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("accessibility") }),
  Schema.Struct({
    kind: Schema.Literal("automation"),
    bundleId: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal("fullDiskAccess") }),
);

export type GrantRequest = Schema.Schema.Type<typeof GrantRequest>;

export const PermissionItem = Schema.Struct({
  name: Schema.String,
  gives: Schema.String,
  loss: Schema.String,
  state: GrantState,
  request: GrantRequest,
});

export type PermissionItem = Schema.Schema.Type<typeof PermissionItem>;

export const permissionItems = (
  p: Permissions,
): ReadonlyArray<PermissionItem> => {
  const automation = Object.entries(p.automation)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .filter(([, state]) => state !== "notInstalled")
    .map(([bundleId, state]): PermissionItem => {
      const b = browserName(bundleId);
      return {
        name: `automation ${b}`,
        gives: `URLs in ${b}`,
        loss: `URLs in ${b} are not tracked`,
        state,
        request: { kind: "automation", bundleId },
      };
    });
  return [
    {
      name: "accessibility",
      gives: "window titles",
      loss: "window titles are not tracked",
      state: p.accessibility,
      request: { kind: "accessibility" },
    },
    ...automation,
    {
      name: "full disk access",
      gives: "iPhone and iPad import",
      loss: "iPhone and iPad time is not imported",
      state: p.fullDiskAccess,
      request: { kind: "fullDiskAccess" },
    },
  ];
};

export const requestArgs = (r: GrantRequest): ReadonlyArray<string> => {
  switch (r.kind) {
    case "accessibility":
      return ["accessibility"];
    case "automation":
      return ["automation", r.bundleId];
    case "fullDiskAccess":
      return ["fulldiskaccess"];
  }
};

export const tccService = (
  r: GrantRequest,
): "Accessibility" | "AppleEvents" | "SystemPolicyAllFiles" => {
  switch (r.kind) {
    case "accessibility":
      return "Accessibility";
    case "automation":
      return "AppleEvents";
    case "fullDiskAccess":
      return "SystemPolicyAllFiles";
  }
};

export const RequestOutcome = Schema.Literal("asked", "notRunning");

export type RequestOutcome = Schema.Schema.Type<typeof RequestOutcome>;

export const RequestOutcomeLine = Schema.parseJson(
  Schema.Struct({ outcome: Schema.Literal("asked", "notRunning") }),
);

export const decodeRequestOutcome = Schema.decodeUnknown(RequestOutcomeLine);
