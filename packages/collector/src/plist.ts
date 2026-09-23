import { Schema } from "effect";

export const collectorLabel = "com.clocktrace.collector";

const escapeXml = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// What the Collector's plist holds: how launchd starts it and the settings
// it runs with.
export const CollectorPlist = Schema.Struct({
  app: Schema.String,
  node: Schema.String,
  entry: Schema.String,
  databasePath: Schema.String,
  helperPath: Schema.String,
  logPath: Schema.String,
});

export type CollectorPlist = Schema.Schema.Type<typeof CollectorPlist>;

// A key of plutil's JSON, read under a camelCase name.
const plistKey = <S extends Schema.Schema.Any>(key: string, schema: S) =>
  Schema.propertySignature(schema).pipe(Schema.fromKey(key));

// The JSON `plutil -convert json` prints for a plist collectorPlist wrote.
// A plist in another layout does not decode.
const PlutilJson = Schema.Struct({
  programArguments: plistKey(
    "ProgramArguments",
    Schema.Tuple(
      Schema.String,
      Schema.Literal("spawn"),
      Schema.String,
      Schema.String,
    ),
  ),
  environment: plistKey(
    "EnvironmentVariables",
    Schema.Struct({
      databasePath: plistKey("CLOCKTRACE_DB", Schema.String),
      helperPath: plistKey("CLOCKTRACE_HELPER", Schema.String),
    }),
  ),
  logPath: plistKey("StandardOutPath", Schema.String),
});

export const CollectorPlistFromJson = Schema.transform(
  Schema.parseJson(PlutilJson),
  CollectorPlist,
  {
    strict: true,
    decode: ({ programArguments, environment, logPath }) => ({
      app: programArguments[0],
      node: programArguments[2],
      entry: programArguments[3],
      databasePath: environment.databasePath,
      helperPath: environment.helperPath,
      logPath,
    }),
    encode: (plist) => ({
      programArguments: [plist.app, "spawn", plist.node, plist.entry] as const,
      environment: {
        databasePath: plist.databasePath,
        helperPath: plist.helperPath,
      },
      logPath: plist.logPath,
    }),
  },
);

export const collectorPlist = (
  input: CollectorPlist,
): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${collectorLabel}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(input.app)}</string>
    <string>spawn</string>
    <string>${escapeXml(input.node)}</string>
    <string>${escapeXml(input.entry)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CLOCKTRACE_DB</key>
    <string>${escapeXml(input.databasePath)}</string>
    <key>CLOCKTRACE_HELPER</key>
    <string>${escapeXml(input.helperPath)}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${escapeXml(input.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(input.logPath)}</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`;
