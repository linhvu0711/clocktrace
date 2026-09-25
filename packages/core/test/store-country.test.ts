import { DateTime, Option } from "effect";
import { describe, expect, it } from "vitest";

import { storeCountry } from "../src/index.js";

describe("storeCountry", () => {
  it("Asia/Saigon maps to vn", () => {
    // Given
    const zone = DateTime.zoneUnsafeMakeNamed("Asia/Saigon");
    // When
    const country = storeCountry(zone);
    // Then
    expect(country).toEqual(Option.some("vn"));
  });

  it("a renamed zone maps like its old name", () => {
    // Given: the new names of Asia/Saigon and Asia/Calcutta
    const zones = [
      DateTime.zoneUnsafeMakeNamed("Asia/Ho_Chi_Minh"),
      DateTime.zoneUnsafeMakeNamed("Asia/Kolkata"),
    ];
    // When
    const countries = zones.map(storeCountry);
    // Then
    expect(countries).toEqual([Option.some("vn"), Option.some("in")]);
  });

  it("Europe/London maps to gb", () => {
    // Given
    const zone = DateTime.zoneUnsafeMakeNamed("Europe/London");
    // When
    const country = storeCountry(zone);
    // Then
    expect(country).toEqual(Option.some("gb"));
  });

  it("zones with no country map to none", () => {
    // Given: UTC, an Etc zone, and a fixed offset
    const zones = [
      DateTime.zoneUnsafeMakeNamed("UTC"),
      DateTime.zoneUnsafeMakeNamed("Etc/GMT+7"),
      DateTime.zoneMakeOffset(7 * 60 * 60 * 1000),
    ];
    // When
    const countries = zones.map(storeCountry);
    // Then
    expect(countries).toEqual([Option.none(), Option.none(), Option.none()]);
  });
});
