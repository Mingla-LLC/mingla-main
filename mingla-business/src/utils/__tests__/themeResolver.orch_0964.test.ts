import { describe, expect, test } from "@jest/globals";

import {
  computeForeground,
  resolveTheme,
} from "../../../../packages/offering-rendering/themeResolver";

describe("ORCH-0964 theme resolver", () => {
  test("uses the Mingla default when brand and event theme are null", () => {
    expect(resolveTheme(null, null)).toMatchObject({
      color: "#eb7825",
      font: "inter",
      animation: "none",
    });
  });

  test("event overrides win partially and inherit unset brand/default fields", () => {
    expect(
      resolveTheme(
        { color: "#ff6f00", font: "playfair_display", animation: "confetti" },
        { color: "#2563eb", font: null, animation: null },
      ),
    ).toMatchObject({
      color: "#2563eb",
      font: "playfair_display",
      animation: "confetti",
    });
  });

  test("foreground color flips for bright and dark theme colors", () => {
    expect(computeForeground("#ffff00")).toBe("#000000");
    expect(computeForeground("#000080")).toBe("#ffffff");
  });

  test("invalid DB values are ignored instead of crashing", () => {
    expect(
      resolveTheme(
        { color: "#zz1234", font: "not-a-font", animation: "bad" },
        { color: null, font: null, animation: null },
      ),
    ).toMatchObject({
      color: "#eb7825",
      font: "inter",
      animation: "none",
    });
  });
});
