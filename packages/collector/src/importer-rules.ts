// The issue's constants: the macOS majors the importer was verified on
// (ADR 0004), the iOS system screens that are not Activities, the
// DevicePeer platform map, the import interval, and the sync bound.
export const verifiedMacosMajors: ReadonlyArray<number> = [27];

export const droppedBundleIds: ReadonlyArray<string> = [
  "com.apple.SleepLockScreen",
  "com.apple.control-center",
  "com.apple.ClockAngel",
];

export const droppedBundlePrefixes: ReadonlyArray<string> = [
  "com.apple.springboard.",
];

export const isDroppedBundleId = (id: string): boolean =>
  droppedBundleIds.includes(id) ||
  droppedBundlePrefixes.some((p) => id.startsWith(p));

export const platformKinds: Record<number, "iphone" | "ipad"> = {
  1: "ipad",
  2: "iphone",
};

export const importEvery = "15 minutes";

export const syncStaleAfterMillis = 24 * 60 * 60 * 1000;
