import { DateTime, Option } from "effect";

// ES2022 types neither: Node 24 has getTimeZones(), Node 22 only the
// timeZones getter.
type LocaleZones = {
  getTimeZones?: () => ReadonlyArray<string>;
  timeZones?: ReadonlyArray<string>;
};

const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// Canonical so a renamed zone (`Asia/Ho_Chi_Minh`) matches the name ICU
// lists (`Asia/Saigon`).
const canonicalZone = (id: string): string =>
  new Intl.DateTimeFormat("en", { timeZone: id }).resolvedOptions().timeZone;

// Canonical zone → lowercase store country. Built on first use: the scan of
// every two-letter region costs about 140 ms.
let countryByZone: Map<string, string> | undefined;

const buildCountryByZone = (): Map<string, string> => {
  const table = new Map<string, string>();
  for (const first of letters) {
    for (const second of letters) {
      const locale = new Intl.Locale(`und-${first}${second}`);
      const zones = locale as unknown as LocaleZones;
      const region = locale.region;
      if (region === undefined) {
        continue;
      }
      for (const zone of zones.getTimeZones?.() ?? zones.timeZones ?? []) {
        table.set(canonicalZone(zone), region.toLowerCase());
      }
    }
  }
  return table;
};

// The App Store country of a time zone, as `vn` for `Asia/Saigon`. None for a
// zone no country uses (`UTC`, `Etc/*`) and for a fixed offset.
export const storeCountry = (
  zone: DateTime.TimeZone,
): Option.Option<string> => {
  if (!DateTime.isTimeZoneNamed(zone)) {
    return Option.none();
  }
  countryByZone ??= buildCountryByZone();
  return Option.fromNullable(countryByZone.get(canonicalZone(zone.id)));
};
