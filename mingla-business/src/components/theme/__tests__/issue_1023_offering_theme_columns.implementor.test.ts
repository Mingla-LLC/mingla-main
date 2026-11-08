/**
 * issue #1023 wave 2 — P-6. The offering theme column contract carries the
 * gradient as ONE value beside the colour.
 *
 * Invalidated (2026-11-07, migration applied): the "[TRANSITIONAL] the
 * gradient-column fallback" block — the retry-without-the-column helper was
 * deleted once production had the columns.
 *
 * Fails on revert: themeOverridesToColumns losing theme_gradient_override,
 * reading a stale pair as a gradient, or keeping color2 without a colour.
 */
import { describe, expect, test } from "@jest/globals";

import {
  THEME_OVERRIDE_COLUMNS,
  normalizeThemeOverrides,
  themeOverridesFromColumns,
  themeOverridesToColumns,
} from "../../../services/offeringTheme";

describe("offering theme columns", () => {
  test("the column list includes the gradient", () => {
    expect(THEME_OVERRIDE_COLUMNS).toContain("theme_gradient_override");
  });

  test("a gradient round-trips through the columns as one value", () => {
    const cols = themeOverridesToColumns({ color: "#E8508F", color2: "#7C5CFF", font: "Roboto Slab", animation: null });
    expect(cols).toEqual({
      theme_color_override: "#E8508F",
      theme_font_override: "Roboto Slab",
      theme_animation_override: null,
      theme_gradient_override: "#e8508f,#7c5cff",
    });
    expect(themeOverridesFromColumns(cols)).toEqual({
      color: "#E8508F",
      color2: "#7c5cff",
      font: "Roboto Slab",
      animation: null,
    });
  });

  test("a solid commit clears the gradient column", () => {
    expect(themeOverridesToColumns({ color: "#ff5a5f", font: null, animation: null }).theme_gradient_override).toBeNull();
  });

  test("a bundled family is written as its slug", () => {
    expect(themeOverridesToColumns({ color: null, font: "Inter", animation: null }).theme_font_override).toBe("inter");
  });

  test("a stale pair (first stop is not the colour) reads as solid", () => {
    expect(
      themeOverridesFromColumns({
        theme_color_override: "#22c55e",
        theme_font_override: null,
        theme_animation_override: null,
        theme_gradient_override: "#e8508f,#7c5cff",
      }),
    ).toEqual({ color: "#22c55e", font: null, animation: null });
  });

  test("color2 without a colour is dropped, and alone it keeps nothing alive", () => {
    expect(normalizeThemeOverrides({ color: null, color2: "#7c5cff", font: null, animation: null })).toBeNull();
    expect(normalizeThemeOverrides({ color: null, color2: "#7c5cff", font: "lora", animation: null })).toEqual({
      color: null,
      font: "lora",
      animation: null,
    });
  });
});
