/**
 * issue #1023 wave 2 — P-6. The offering theme column contract carries the
 * gradient as ONE value beside the colour, and the transitional
 * missing-column fallback retries only when the database says the gradient
 * column does not exist yet.
 *
 * Fails on revert: themeOverridesToColumns losing theme_gradient_override,
 * reading a stale pair as a gradient, keeping color2 without a colour, or the
 * fallback retrying on unrelated errors.
 */
import { describe, expect, test } from "@jest/globals";

import {
  THEME_OVERRIDE_COLUMNS,
  normalizeThemeOverrides,
  themeOverridesFromColumns,
  themeOverridesToColumns,
} from "../../../services/offeringTheme";
import {
  isMissingGradientColumnError,
  withGradientColumnFallback,
  withoutGradientColumns,
} from "../../../../../packages/offering-rendering/themeGradientColumnFallback";

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

describe("[TRANSITIONAL] the gradient-column fallback", () => {
  test("recognises only a missing gradient column", () => {
    expect(isMissingGradientColumnError({ code: "42703", message: "column events.theme_gradient_override does not exist" })).toBe(true);
    expect(isMissingGradientColumnError({ code: "PGRST204", message: "Could not find the 'theme_gradient' column of 'brands' in the schema cache" })).toBe(true);
    expect(isMissingGradientColumnError({ code: "42703", message: "column events.other does not exist" })).toBe(false);
    expect(isMissingGradientColumnError({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingGradientColumnError(null)).toBe(false);
  });

  test("retries once without the column, and never on another error", async () => {
    const calls: boolean[] = [];
    const missing = await withGradientColumnFallback(async (g) => {
      calls.push(g);
      return g
        ? { data: null, error: { code: "42703", message: "column business_public_events_view.brand_theme_gradient does not exist" } }
        : { data: "row", error: null };
    });
    expect(calls).toEqual([true, false]);
    expect(missing.data).toBe("row");

    calls.length = 0;
    const other = await withGradientColumnFallback(async (g) => {
      calls.push(g);
      return { data: null, error: { code: "42501", message: "permission denied" } };
    });
    expect(calls).toEqual([true]);
    expect(other.error).toEqual({ code: "42501", message: "permission denied" });
  });

  test("withoutGradientColumns drops only the gradient names", () => {
    expect(withoutGradientColumns("a,theme_color_override,theme_gradient_override,b")).toBe("a,theme_color_override,b");
    expect(withoutGradientColumns("brand_theme_color, brand_theme_gradient")).toBe("brand_theme_color");
  });
});
