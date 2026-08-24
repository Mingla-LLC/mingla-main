/**
 * #2514 adversarial regression.
 *
 * # Adversarial angle
 * The happy-path file proves the brand filter is PRESENT. This file attacks
 * the ways the fix silently half-reverts:
 *
 *   1. A CALLER left on the old shape. The bug was never in the service alone
 *      — it was that no caller ever passed a brand. A service that accepts
 *      `brand_id` while a screen still passes `account_id` reintroduces the
 *      exact defect on that screen only, and no service-level test sees it.
 *   2. SHARED CACHE KEYS. If any campaign key is still account-keyed, two
 *      brands collide in one React Query entry and switching brand serves the
 *      previous brand's list from cache — the original symptom, restored.
 */
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..", "..", "..", "..");
const read = (...p: string[]): string => readFileSync(join(ROOT, ...p), "utf8");

const CALLERS = [
  ["app", "(tabs)", "marketing", "campaigns", "index.tsx"],
  ["app", "(tabs)", "marketing", "index.tsx"],
  ["src", "components", "ui", "CommandPalette.web.tsx"],
];

describe("#2514 no caller is left on the account-scoped shape", () => {
  it.each(CALLERS)("%s/%s/%s/%s/%s passes a brand, never account_id", (...parts) => {
    const source = read(...(parts as string[]));
    expect(source).not.toContain("account_id: accountId");
    expect(source).not.toMatch(/useCampaigns\(\{\s*account_id/);
    expect(source).not.toMatch(/useMarketingOverview\(accountId\)/);
  });

  it("the campaigns screen reads the ACTIVE brand, not the signed-in user", () => {
    const source = read("app", "(tabs)", "marketing", "campaigns", "index.tsx");
    expect(source).toContain("useCurrentBrand()");
    expect(source).toContain("brand_id: brandId");
  });

  it("the overview screen reads the ACTIVE brand", () => {
    const source = read("app", "(tabs)", "marketing", "index.tsx");
    expect(source).toContain("useCurrentBrand()");
    expect(source).toContain("useMarketingOverview(currentBrand?.id ?? null)");
  });
});

describe("#2514 no campaign cache key can collide across brands", () => {
  const KEYS = read("src", "hooks", "marketing", "marketingKeys.ts");
  /**
   * The CAMPAIGNS block only. `audiences.list` is also `(accountId: string)`
   * and is legitimately account-scoped, so a file-wide regex here would fail
   * against a correct implementation — the same over-broad-match trap as
   * `reference_audit_regex_matches_comments_same_file`.
   */
  const campaignsBlock = KEYS.slice(
    KEYS.indexOf("campaigns: {"),
    KEYS.indexOf("overview: {"),
  );

  it("the campaign list key takes a brandId parameter", () => {
    expect(campaignsBlock).toMatch(/list:\s*\(brandId: string/);
    expect(campaignsBlock).not.toMatch(/list:\s*\(accountId: string/);
  });

  it("the overview key takes a brandId parameter", () => {
    expect(KEYS).toMatch(/byBrand:\s*\(brandId: string/);
  });

  it("the hooks feed the brand into the key they query with", () => {
    const useCampaigns = read("src", "hooks", "marketing", "useCampaigns.ts");
    expect(useCampaigns).toContain(
      "marketingKeys.campaigns.list(input.brand_id as string",
    );
    expect(useCampaigns).toContain("brand_id: input.brand_id as string");
    // Key and query must agree, or the cache lies about what it holds.
    expect(useCampaigns).not.toContain("account_id");
  });
});

describe("#2514 scope discipline", () => {
  it("does not silently rescope audiences or templates", () => {
    // Those surfaces had no reported defect; rescoping them here would be
    // scope creep with its own blast radius.
    const palette = read("src", "components", "ui", "CommandPalette.web.tsx");
    expect(palette).toContain("useAudienceList(accountId)");
    expect(palette).toContain("useUserTemplates(accountId)");
  });
});
