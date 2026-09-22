import { Option } from "effect";
import { describe, expect, it } from "vitest";

import { colorEnabled, line, mark, unicodeEnabled } from "../src/format.js";

describe("format", () => {
  it("color is off when stdout is not a terminal", () => {
    // Given / When / Then
    expect(colorEnabled(false, Option.none())).toBe(false);
  });

  it("color is off when NO_COLOR is set on a terminal", () => {
    // Given / When / Then
    expect(colorEnabled(true, Option.some("1"))).toBe(false);
  });

  it("color is on for a terminal when NO_COLOR is unset or empty", () => {
    // Given / When / Then
    expect([
      colorEnabled(true, Option.none()),
      colorEnabled(true, Option.some("")),
    ]).toEqual([true, true]);
  });

  it("marks fall back to ASCII only on the Linux console", () => {
    // Given / When / Then
    expect([
      unicodeEnabled(Option.some("linux")),
      unicodeEnabled(Option.some("xterm-256color")),
      unicodeEnabled(Option.none()),
      mark("ok", { color: false, unicode: false }).text,
      mark("warn", { color: false, unicode: false }).text,
      mark("bad", { color: false, unicode: false }).text,
    ]).toEqual([false, true, true, "ok", "--", "x"]);
  });

  it("a painted mark carries the green bytes when color is on", () => {
    // Given
    const color = { color: true, unicode: true };
    // When / Then
    expect(line([mark("ok", color), " running"], color)).toBe(
      "\u001b[0;32m✔\u001b[0m running",
    );
  });

  it("a painted mark is the bare glyph when color is off", () => {
    // Given
    const plain = { color: false, unicode: true };
    // When / Then
    expect(line([mark("ok", plain), " running"], plain)).toBe("✔ running");
  });
});
