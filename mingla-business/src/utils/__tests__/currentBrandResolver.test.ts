import { describe, expect, test } from "@jest/globals";

import { resolveCurrentBrandId } from "../currentBrandResolver";

const brand = (id: string): { id: string } => ({ id });

describe("resolveCurrentBrandId", () => {
  test("keeps a valid local selection before server default", () => {
    expect(
      resolveCurrentBrandId({
        currentBrandId: "brand-b",
        defaultBrandId: "brand-a",
        brands: [brand("brand-b"), brand("brand-a")],
      }),
    ).toEqual({ brandId: "brand-b", reason: "keep-local" });
  });

  test("uses a valid server default when local selection is empty", () => {
    expect(
      resolveCurrentBrandId({
        currentBrandId: null,
        defaultBrandId: "brand-a",
        brands: [brand("brand-b"), brand("brand-a")],
      }),
    ).toEqual({ brandId: "brand-a", reason: "server-default" });
  });

  test("falls back to newest fetched brand when server default is invalid", () => {
    expect(
      resolveCurrentBrandId({
        currentBrandId: null,
        defaultBrandId: "brand-z",
        brands: [brand("brand-b"), brand("brand-a")],
      }),
    ).toEqual({ brandId: "brand-b", reason: "newest-brand" });
  });

  test("falls back to newest fetched brand when no default exists", () => {
    expect(
      resolveCurrentBrandId({
        currentBrandId: null,
        defaultBrandId: null,
        brands: [brand("brand-b"), brand("brand-a")],
      }),
    ).toEqual({ brandId: "brand-b", reason: "newest-brand" });
  });

  test("returns none when no brands exist", () => {
    expect(
      resolveCurrentBrandId({
        currentBrandId: null,
        defaultBrandId: null,
        brands: [],
      }),
    ).toEqual({ brandId: null, reason: "none" });
  });

  test("uses a valid default when local selection is invalid", () => {
    expect(
      resolveCurrentBrandId({
        currentBrandId: "brand-z",
        defaultBrandId: "brand-a",
        brands: [brand("brand-b"), brand("brand-a")],
      }),
    ).toEqual({ brandId: "brand-a", reason: "server-default" });
  });
});
