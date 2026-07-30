import { queryClient } from "../../config/queryClient";
import type { Brand } from "../../types/brand";
import { getBrandFromCache } from "../brandCache";
import { brandKeys } from "../brandKeys";

const brand = (id: string, displayName: string): Brand =>
  ({
    id,
    displayName,
    slug: id,
  }) as Brand;

describe("issue #874 hook-free brand cache lookup", () => {
  beforeEach(() => {
    queryClient.clear();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it("returns null without a brand id", () => {
    queryClient.setQueryData(brandKeys.detail("brand-a"), brand("brand-a", "A"));
    expect(getBrandFromCache(null)).toBeNull();
  });

  it("returns the detail-cache match first", () => {
    const detail = brand("brand-a", "Detail");
    queryClient.setQueryData(brandKeys.detail("brand-a"), detail);
    queryClient.setQueryData(brandKeys.list("account-a"), [
      brand("brand-a", "List"),
    ]);
    expect(getBrandFromCache("brand-a")).toBe(detail);
  });

  it("falls back to a matching brand in list caches", () => {
    const match = brand("brand-b", "List match");
    queryClient.setQueryData(brandKeys.list("account-a"), [
      brand("brand-a", "Other"),
      match,
    ]);
    expect(getBrandFromCache("brand-b")).toBe(match);
  });

  it("returns null when no cache contains the brand", () => {
    queryClient.setQueryData(brandKeys.list("account-a"), [
      brand("brand-a", "Other"),
    ]);
    expect(getBrandFromCache("brand-missing")).toBeNull();
  });
});
