import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  Permissions,
  permissionItems,
  requestArgs,
} from "../src/permissions.js";

const line =
  '{"accessibility":"granted","automation":{"com.apple.Safari":"notRunning","com.brave.Browser":"granted","com.google.Chrome":"notAsked","com.microsoft.edgemac":"notInstalled","com.operasoftware.Opera":"notInstalled","com.vivaldi.Vivaldi":"notInstalled","org.chromium.Chromium":"notInstalled"},"fullDiskAccess":"denied"}';

describe("permissions", () => {
  it("decodes the helper's permissions line", () => {
    // Given: the sample line at packages/helper/README.md:61
    // When
    const p = Schema.decodeUnknownSync(Permissions)(line);
    // Then
    expect(p.accessibility).toBe("granted");
    expect(p.automation["com.apple.Safari"]).toBe("notRunning");
    expect(p.automation["com.microsoft.edgemac"]).toBe("notInstalled");
    expect(p.fullDiskAccess).toBe("denied");
  });

  it("items list installed browsers by bundle id with display names", () => {
    // Given: the same decoded value
    const p = Schema.decodeUnknownSync(Permissions)(line);
    // When
    const items = permissionItems(p).map((i) => [i.name, i.state]);
    // Then
    expect(items).toEqual([
      ["accessibility", "granted"],
      ["automation Safari", "notRunning"],
      ["automation Brave", "granted"],
      ["automation Chrome", "notAsked"],
      ["full disk access", "denied"],
    ]);
  });

  it("an unknown bundle id keeps its id", () => {
    // Given: one browser not in the name map
    const p = {
      accessibility: "granted" as const,
      automation: { "org.example.Browser": "granted" as const },
      fullDiskAccess: "granted" as const,
    };
    // When
    const item = permissionItems(p)[1];
    // Then
    expect(item).toEqual({
      name: "automation org.example.Browser",
      gives: "URLs in org.example.Browser",
      loss: "URLs in org.example.Browser are not tracked",
      state: "granted",
      request: { kind: "automation", bundleId: "org.example.Browser" },
    });
  });

  it("requestArgs match the helper's words", () => {
    // Given: the three request kinds, automation with com.apple.Safari
    // When
    const args = [
      requestArgs({ kind: "accessibility" }),
      requestArgs({ kind: "automation", bundleId: "com.apple.Safari" }),
      requestArgs({ kind: "fullDiskAccess" }),
    ];
    // Then
    expect(args).toEqual([
      ["accessibility"],
      ["automation", "com.apple.Safari"],
      ["fulldiskaccess"],
    ]);
  });
});
