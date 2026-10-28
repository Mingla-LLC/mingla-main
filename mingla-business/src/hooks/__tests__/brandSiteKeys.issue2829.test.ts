/*
 * #2829 — one key factory per entity (Constitution 4): the inline Website
 * query keys moved into brandSiteKeys, and every key sits under `all`.
 */
jest.mock("../../services/supabase", () => ({ supabase: {} }));
jest.mock("../../context/AuthContext", () => ({ useAuth: () => ({ isAuthReady: true }) }));
jest.mock("@react-native-async-storage/async-storage", () => ({}));

import { readFileSync } from "fs";
import { join } from "path";
import { brandSiteKeys } from "../useBrandSite";

describe("#2829 brandSiteKeys", () => {
  it("names every Website key from the factory, all under the same root", () => {
    const keys = [
      brandSiteKeys.detail("b"), brandSiteKeys.label("b"), brandSiteKeys.operation("s", "o"),
      brandSiteKeys.versions("s"), brandSiteKeys.analytics("s"), brandSiteKeys.exports("s", "o"),
      brandSiteKeys.enquiries("s"), brandSiteKeys.plan("b"), brandSiteKeys.domains("s"),
    ];
    for (const key of keys) expect(key[0]).toBe(brandSiteKeys.all[0]);
    expect(new Set(keys.map((key) => JSON.stringify(key))).size).toBe(keys.length);
  });

  it("leaves no inline query key in the hook file", () => {
    const source = readFileSync(join(__dirname, "..", "useBrandSite.ts"), "utf8");
    expect(source).not.toMatch(/queryKey:\s*\[/);
  });
});
