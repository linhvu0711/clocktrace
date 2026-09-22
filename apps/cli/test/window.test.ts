import { describe, expect, it } from "vitest";

import { windowLine } from "../src/window.js";

const plain = { color: false, unicode: true, width: 0 };

describe("windowLine", () => {
  it("a bare from and to on one day print the day and whole day", () => {
    // Given: plain
    // When / Then
    expect(
      windowLine(
        { from: "2026-09-18", to: "2026-09-18" },
        "America/Los_Angeles",
        plain,
      ),
    ).toBe("2026-09-18 whole day · America/Los_Angeles");
  });

  it("an extra part joins with a middle dot", () => {
    // Given: plain
    // When / Then
    expect(
      windowLine(
        { from: "2026-09-18", to: "2026-09-18" },
        "America/Los_Angeles",
        plain,
        "by app",
      ),
    ).toBe("2026-09-18 whole day · America/Los_Angeles · by app");
  });

  it("two times on one day print the day once", () => {
    // Given: plain
    // When / Then
    expect(
      windowLine(
        { from: "2026-09-18T09:00", to: "2026-09-18T12:00" },
        "America/Los_Angeles",
        plain,
      ),
    ).toBe("2026-09-18 09:00 to 12:00 · America/Los_Angeles");
  });

  it("two bare days print from to to", () => {
    // Given: plain
    // When / Then
    expect(
      windowLine(
        { from: "2026-09-17", to: "2026-09-18" },
        "America/Los_Angeles",
        plain,
      ),
    ).toBe("2026-09-17 to 2026-09-18 · America/Los_Angeles");
  });

  it("times on two days print both days", () => {
    // Given: plain
    // When / Then
    expect(
      windowLine(
        { from: "2026-09-17T22:00", to: "2026-09-18T02:00" },
        "America/Los_Angeles",
        plain,
      ),
    ).toBe("2026-09-17 22:00 to 2026-09-18 02:00 · America/Los_Angeles");
  });

  it("a bare side next to a timed side prints 00:00 or 24:00", () => {
    // Given: plain
    // When / Then
    expect([
      windowLine(
        { from: "2026-09-18", to: "2026-09-18T12:00" },
        "America/Los_Angeles",
        plain,
      ),
      windowLine(
        { from: "2026-09-18T09:00", to: "2026-09-18" },
        "America/Los_Angeles",
        plain,
      ),
    ]).toEqual([
      "2026-09-18 00:00 to 12:00 · America/Los_Angeles",
      "2026-09-18 09:00 to 24:00 · America/Los_Angeles",
    ]);
  });

  it("the day is bold and the rest dim when color is on", () => {
    // Given
    const color = { color: true, unicode: true, width: 0 };
    // When / Then
    expect(
      windowLine(
        { from: "2026-09-18", to: "2026-09-18" },
        "America/Los_Angeles",
        color,
      ),
    ).toBe("[0;1m2026-09-18[0m [0;90mwhole day · America/Los_Angeles[0m");
  });
});
