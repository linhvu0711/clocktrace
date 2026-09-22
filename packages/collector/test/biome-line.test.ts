import { Effect, Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  BiomeLine,
  DevicePeerLine,
  decodeBiomeLine,
} from "../src/biome-line.js";

const R3 =
  '{"bundleId":"com.apple.mobilesafari","device":"00000000-0000-4000-8000-000000000002","focus":"start","offset":184,"segment":"000000000000001","ts":1789833660,"appVersion":null,"build":null,"reason":null}';
const E1 = '{"error":"parse","offset":148,"segment":"000000000000001"}';
const D_PAD =
  '{"deviceIdentifier":"00000000-0000-4000-8000-000000000003","lastSyncDate":1789664400,"me":false,"model":"24A437","name":"Linh\'s iPad","platform":1}';

describe("biome-line", () => {
  it("decodes a record line", () => {
    // Given: the record line R3
    // When
    const line = Schema.decodeUnknownSync(BiomeLine)(R3);
    // Then
    expect(line).toEqual({
      device: "00000000-0000-4000-8000-000000000002",
      ts: 1789833660,
      focus: "start",
      bundleId: "com.apple.mobilesafari",
      reason: null,
      appVersion: null,
      build: null,
      segment: "000000000000001",
      offset: 184,
    });
  });

  it("decodes a parse error line", () => {
    // Given: the parse error line E1
    // When
    const line = Schema.decodeUnknownSync(BiomeLine)(E1);
    // Then
    expect(line).toEqual({
      error: "parse",
      segment: "000000000000001",
      offset: 148,
    });
  });

  it("decodes a DevicePeer line", () => {
    // Given: the DevicePeer line D_PAD
    // When
    const line = Schema.decodeUnknownSync(DevicePeerLine)(D_PAD);
    // Then
    expect(line).toEqual({
      deviceIdentifier: "00000000-0000-4000-8000-000000000003",
      me: false,
      name: "Linh's iPad",
      model: "24A437",
      platform: 1,
      lastSyncDate: 1789664400,
    });
  });

  it("rejects a line that is not a record", () => {
    // Given: a line whose shape matches no BiomeLine
    // When
    const exit = Effect.runSyncExit(decodeBiomeLine('{"app":"Safari"}'));
    // Then
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
