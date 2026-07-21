import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/**
 * #1022 — the canonical offering-theme column contract.
 *
 * Covers SPEC test cases:
 *   T-3  normaliser (undefined / null / all-null / partial)
 *   T-6  per-axis write — only the set axis reaches its column
 *   T-7  rowcount guard — a 0-row update throws instead of silently succeeding
 *
 * Fails-on-revert target: delete `normalizeThemeOverrides`'s all-null collapse,
 * or the `data.length === 0` throw, and this suite goes red.
 */

type UpdateResult = { data: unknown; error: { message?: string } | null };

const selectMock = jest.fn<() => Promise<UpdateResult>>();
const eqMock = jest.fn<(...args: unknown[]) => { select: typeof selectMock }>(() => ({
  select: selectMock,
}));
const updateMock = jest.fn<(...args: unknown[]) => { eq: typeof eqMock }>(() => ({
  eq: eqMock,
}));
const fromMock = jest.fn<(...args: unknown[]) => { update: typeof updateMock }>(() => ({
  update: updateMock,
}));

jest.mock("../supabase", () => ({
  supabase: {
    from: fromMock,
  },
}));

import {
  THEME_OVERRIDE_COLUMNS,
  normalizeThemeOverrides,
  patchOfferingTheme,
  themeAxisIsInherited,
  themeOverridesFromColumns,
  themeOverridesToColumns,
} from "../offeringTheme";

beforeEach(() => {
  jest.clearAllMocks();
  selectMock.mockResolvedValue({ data: [{ id: "evt-1" }], error: null });
});

describe("T-3 — normalizeThemeOverrides", () => {
  test("undefined collapses to null", () => {
    expect(normalizeThemeOverrides(undefined)).toBeNull();
  });

  test("null collapses to null", () => {
    expect(normalizeThemeOverrides(null)).toBeNull();
  });

  test("all-null object collapses to null (the C-3 phantom-diff root)", () => {
    expect(
      normalizeThemeOverrides({ color: null, font: null, animation: null }),
    ).toBeNull();
  });

  test("every all-null permutation collapses to null", () => {
    expect(normalizeThemeOverrides({} as never)).toBeNull();
    expect(normalizeThemeOverrides({ color: null } as never)).toBeNull();
    expect(normalizeThemeOverrides({ font: null } as never)).toBeNull();
    expect(normalizeThemeOverrides({ animation: null } as never)).toBeNull();
  });

  test("a partial override keeps every axis explicitly present", () => {
    expect(
      normalizeThemeOverrides({ color: "#16a34a", font: null, animation: null }),
    ).toEqual({ color: "#16a34a", font: null, animation: null });
  });

  test("null (all inherited) stays distinguishable from a colour-only override", () => {
    const inherited = normalizeThemeOverrides(null);
    const colourOnly = normalizeThemeOverrides({
      color: "#eb7825",
      font: null,
      animation: null,
    });
    expect(inherited).toBeNull();
    expect(colourOnly).not.toBeNull();
    expect(JSON.stringify(inherited)).not.toBe(JSON.stringify(colourOnly));
  });

  test("does not mutate its input", () => {
    const input = { color: "#16a34a", font: null, animation: null };
    const frozen = Object.freeze({ ...input });
    const out = normalizeThemeOverrides(frozen);
    expect(out).not.toBe(frozen);
    expect(frozen).toEqual(input);
  });
});

describe("T-3 — column <-> domain mapping", () => {
  test("the three column names are pinned in one place", () => {
    expect(THEME_OVERRIDE_COLUMNS).toEqual([
      "theme_color_override",
      "theme_font_override",
      "theme_animation_override",
    ]);
  });

  test("an all-null row reads back as null, not {null,null,null}", () => {
    expect(
      themeOverridesFromColumns({
        theme_color_override: null,
        theme_font_override: null,
        theme_animation_override: null,
      }),
    ).toBeNull();
  });

  test("a legacy row missing the columns entirely reads back as null", () => {
    expect(themeOverridesFromColumns({})).toBeNull();
    expect(themeOverridesFromColumns(null)).toBeNull();
    expect(themeOverridesFromColumns(undefined)).toBeNull();
  });

  test("a colour-only row round-trips", () => {
    expect(
      themeOverridesFromColumns({
        theme_color_override: "#16a34a",
        theme_font_override: null,
        theme_animation_override: null,
      }),
    ).toEqual({ color: "#16a34a", font: null, animation: null });
  });

  test("themeOverridesToColumns always returns all three keys", () => {
    expect(themeOverridesToColumns(null)).toEqual({
      theme_color_override: null,
      theme_font_override: null,
      theme_animation_override: null,
    });
    expect(
      themeOverridesToColumns({ color: "#16a34a", font: null, animation: null }),
    ).toEqual({
      theme_color_override: "#16a34a",
      theme_font_override: null,
      theme_animation_override: null,
    });
  });

  test("domain -> columns -> domain is lossless", () => {
    const input = { color: "#16a34a", font: "poppins", animation: "confetti" };
    expect(themeOverridesFromColumns(themeOverridesToColumns(input))).toEqual(input);
  });
});

describe("themeAxisIsInherited reads the RAW override, never a resolved theme", () => {
  test("a fully inherited theme reports every axis inherited", () => {
    expect(themeAxisIsInherited(null, "color")).toBe(true);
    expect(themeAxisIsInherited(null, "font")).toBe(true);
    expect(themeAxisIsInherited(null, "animation")).toBe(true);
  });

  test("a colour-only override inherits font and animation but not colour", () => {
    const t = { color: "#16a34a", font: null, animation: null };
    expect(themeAxisIsInherited(t, "color")).toBe(false);
    expect(themeAxisIsInherited(t, "font")).toBe(true);
    expect(themeAxisIsInherited(t, "animation")).toBe(true);
  });
});

describe("T-6 — patchOfferingTheme writes the three columns", () => {
  test("a colour-only override writes the colour and NULLs the other two axes", async () => {
    await patchOfferingTheme({
      offeringId: "evt-1",
      themeOverrides: { color: "#16a34a", font: null, animation: null },
    });

    expect(fromMock).toHaveBeenCalledWith("events");
    expect(updateMock).toHaveBeenCalledWith({
      theme_color_override: "#16a34a",
      theme_font_override: null,
      theme_animation_override: null,
    });
  });

  test("it targets the row by id only — no event_type filter, so trips and experiences work", async () => {
    await patchOfferingTheme({
      offeringId: "trip-9",
      themeOverrides: { color: "#2563eb", font: null, animation: null },
    });

    expect(eqMock).toHaveBeenCalledTimes(1);
    expect(eqMock).toHaveBeenCalledWith("id", "trip-9");
  });

  test("a null override clears all three columns", async () => {
    await patchOfferingTheme({ offeringId: "evt-1", themeOverrides: null });

    expect(updateMock).toHaveBeenCalledWith({
      theme_color_override: null,
      theme_font_override: null,
      theme_animation_override: null,
    });
  });
});

describe("T-7 — rowcount guard (I-PROPOSED-I)", () => {
  test("a 0-row update throws rather than silently succeeding", async () => {
    selectMock.mockResolvedValue({ data: [], error: null });

    await expect(
      patchOfferingTheme({ offeringId: "evt-gone", themeOverrides: null }),
    ).rejects.toThrow("patch_offering_theme_no_rows");
  });

  test("a null data payload throws", async () => {
    selectMock.mockResolvedValue({ data: null, error: null });

    await expect(
      patchOfferingTheme({ offeringId: "evt-gone", themeOverrides: null }),
    ).rejects.toThrow("patch_offering_theme_no_rows");
  });

  test("a supabase error surfaces its message — never a silent failure", async () => {
    selectMock.mockResolvedValue({ data: null, error: { message: "rls_denied" } });

    await expect(
      patchOfferingTheme({ offeringId: "evt-1", themeOverrides: null }),
    ).rejects.toThrow("rls_denied");
  });
});
