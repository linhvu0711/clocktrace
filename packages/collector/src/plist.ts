export const collectorLabel = "com.clocktrace.collector";

const escapeXml = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export const collectorPlist = (input: {
  readonly node: string;
  readonly entry: string;
  readonly databasePath: string;
  readonly helperPath: string;
  readonly logPath: string;
}): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${collectorLabel}</string>
  <key>ProgramArguments</key>
  <array>
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
