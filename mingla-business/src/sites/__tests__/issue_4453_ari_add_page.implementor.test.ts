/*
 * #4453 milestone 11 (spec v2.1 §3, SC-AP-Web/iOS/Android) — the Host app's
 * "Add a page with Ari": Core's SITES_ARI_ADD_PAGE value is the only gate
 * (flag off = today's Pages section), the chips are the four approved ones
 * (no "Gift ideas", N7), the plan card has its owner words, and the Draft
 * page card answers, publishes and removes through the owner's content
 * actions only.
 * The Pages section's wiring (the flag-gated button, the composer seed, the
 * Draft card's words, the content actions) and the harness's release
 * redirect are source-shape rules: they live in the strict-grep gate
 * .github/scripts/strict-grep/issue-4453-sites-host-wiring.mjs
 * (I-PROPOSED-1047-BIZ-NO-SOLE-SOURCE-PIN: no source-text pins in Jest).
 */
import { join } from "path";
import { normalizeSitePlan } from "../sitePlanState";
import { WRITE_TOOL_OWNER_COPY } from "../../components/ari/toolProposalCopy";
import { ARI_PAGE_CHIPS, ariPagePrompt, unsellableOffer } from "../../../../packages/site-contracts/src/ariPage";

const BRAND = "733bc470-45e1-4684-8896-acd7e26074ff";

describe("#4453 milestone 11 Add a page with Ari (Host app)", () => {
  it("reads Core's flag; anything but true is off", () => {
    expect(normalizeSitePlan(BRAND, { ari_add_page: true }).ariAddPage).toBe(true);
    expect(normalizeSitePlan(BRAND, { ari_add_page: "true" }).ariAddPage).toBe(false);
    expect(normalizeSitePlan(BRAND, {}).ariAddPage).toBe(false);
  });


  it("offers the four approved chips, never gift ideas, and seeds Ari's composer with the owner's topic", () => {
    expect(ARI_PAGE_CHIPS).toEqual(["Private hire", "Our team", "Weddings and celebrations", "Group bookings"]);
    for (const chip of ARI_PAGE_CHIPS) expect(unsellableOffer(chip)).toBeNull();
    expect(unsellableOffer("Gift ideas")).not.toBeNull();
    expect(ariPagePrompt("Private hire")).toBe("Add a page to my website about private hire");
  });

  it("the plan card and the answer card have owner words", () => {
    expect(WRITE_TOOL_OWNER_COPY.propose_site_page).toBeDefined();
    expect(JSON.stringify(WRITE_TOOL_OWNER_COPY.propose_site_page)).toContain("Add as a Draft");
    expect(WRITE_TOOL_OWNER_COPY.answer_site_page_question).toBeDefined();
  });


  it("the add-a-page walk-through harness is dev-only: production Metro never sees it, a release build redirects, no auth", () => {
    const root = join(__dirname, "../../..");
    const harnessPath = join(root, "app/b/__dev-ari-add-page.tsx");
    const blocked = (env: string): boolean => {
      const vars = process.env as Record<string, string | undefined>;
      const previous = vars.NODE_ENV;
      vars.NODE_ENV = env;
      try {
        jest.resetModules();
        const config = jest.requireActual(join(root, "metro.config.js")) as { resolver: { blockList?: RegExp | RegExp[] } };
        const list = config.resolver.blockList;
        return (Array.isArray(list) ? list : list ? [list] : []).some((re) => re.test(harnessPath));
      } finally {
        vars.NODE_ENV = previous;
        jest.resetModules();
      }
    };
    expect(blocked("production")).toBe(true);
    expect(blocked("development")).toBe(false);
  });
});
