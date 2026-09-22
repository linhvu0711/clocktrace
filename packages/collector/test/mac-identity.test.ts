import { Option } from "effect";
import { describe, expect, it } from "vitest";

import { parseHardwareUuid, parseMacosMajor } from "../src/mac-identity.js";

describe("mac-identity", () => {
  it("parseHardwareUuid reads the UUID from ioreg output", () => {
    // Given: ioreg -rd1 -c IOPlatformExpertDevice output
    const text =
      "+-o MacBookPro18,3  <class IOPlatformExpertDevice, id 0x100000110, registered, matched, active, busy 0 (12 ms), retain 40>\n" +
      "    {\n" +
      '      "IOPlatformSerialNumber" = "C02XXXXXXXXX"\n' +
      '      "IOPlatformUUID" = "01234567-89AB-CDEF-0123-456789ABCDEF"\n' +
      "    }\n";
    // When
    const result = parseHardwareUuid(text);
    // Then
    expect(result).toEqual(Option.some("01234567-89AB-CDEF-0123-456789ABCDEF"));
  });

  it("parseHardwareUuid is none without the key", () => {
    // Given: ioreg output with no IOPlatformUUID line
    const text = "+-o MacBookPro18,3\n    {\n    }\n";
    // When
    const result = parseHardwareUuid(text);
    // Then
    expect(result).toEqual(Option.none());
  });

  it("parseMacosMajor reads the major of 27.0", () => {
    // Given: sw_vers -productVersion output
    // When
    const result = parseMacosMajor("27.0");
    // Then
    expect(result).toEqual(Option.some(27));
  });

  it("parseMacosMajor is none for text", () => {
    // Given: a version that is not a number
    // When
    const result = parseMacosMajor("beta");
    // Then
    expect(result).toEqual(Option.none());
  });
});
