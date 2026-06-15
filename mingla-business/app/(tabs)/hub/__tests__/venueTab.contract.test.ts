/**
 * ORCH-1145 — Venue Hub tab relocation, source-contract gate (T-1..T-10).
 *
 * The business jest harness is node/ts-jest with NO React Native renderer
 * (importing `useHubTabs.ts` pulls AuthContext → RN JSX, which the node env
 * cannot evaluate). So — exactly like `hub-layout-nav-lock.test.ts` and
 * `listing.orch_1040.test.ts` — this gate asserts the SOURCE contract verbatim.
 *
 * It pins the conditional Venue pill (visibility gated on hasPhysicalLocation ||
 * placePoolId), the pill definition/route/active-detection, the brand-page row
 * removal (fails-on-revert per SPEC §9 safeguard 1), the visibility-gate
 * append (fails-on-revert per SPEC §9 safeguard 2 — I-PROPOSED-1145-VENUE-TAB-
 * CONDITIONAL), the content-only tab rendering real management UI (no dead tap),
 * and the preserved route alias (fails-on-revert per SPEC §9 safeguard 3).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

// __dirname = app/(tabs)/hub/__tests__ ; biz root is four levels up.
const biz = (rel: string): string =>
  readFileSync(join(__dirname, "../../../..", rel), "utf8");

const USE_HUB_TABS = biz("src/hooks/useHubTabs.ts");
const SUB_NAV = biz("src/components/hub/HubSubNav.tsx");
const HUB_TAB = biz("app/(tabs)/hub/listing.tsx");
const HUB_LAYOUT = biz("app/(tabs)/hub/_layout.tsx");
const CONTENT = biz("src/components/venue/VenueListingContent.tsx");
const REDIRECT = biz("app/brand/[id]/listing.tsx");
const PROFILE = biz("src/components/brand/BrandProfileView.tsx");

describe("ORCH-1145 — Venue Hub tab visibility gate (useHubTabs)", () => {
  // T-1 / T-2 / T-3 / T-4 — deriveHubVisibleTabs conditional venue append.
  test("T-1/T-2/T-3 — venue appended IFF hasPhysicalLocation || hasPlacePool", () => {
    // The append condition (venue pill conditional on the two venue flags).
    expect(USE_HUB_TABS).toMatch(
      /if\s*\(\s*venue\.hasPhysicalLocation\s*\|\|\s*venue\.hasPlacePool\s*\)\s*visible\.push\(\s*["']venue["']\s*\)/,
    );
    // The venue flags input type exists.
    expect(USE_HUB_TABS).toContain("hasPhysicalLocation: boolean");
    expect(USE_HUB_TABS).toContain("hasPlacePool: boolean");
  });

  test("T-4 — venue appended LAST (after events/trips/experiences) for rightmost peer order", () => {
    const eventsIdx = USE_HUB_TABS.indexOf('visible.push("events")');
    const tripsIdx = USE_HUB_TABS.indexOf('visible.push("trips")');
    const expIdx = USE_HUB_TABS.indexOf('visible.push("experiences")');
    const venueIdx = USE_HUB_TABS.indexOf('visible.push("venue")');
    expect(eventsIdx).toBeGreaterThan(-1);
    expect(venueIdx).toBeGreaterThan(-1);
    expect(venueIdx).toBeGreaterThan(eventsIdx);
    expect(venueIdx).toBeGreaterThan(tripsIdx);
    expect(venueIdx).toBeGreaterThan(expIdx);
  });

  test("HubTabName union includes venue + stored-tab guard accepts venue", () => {
    expect(USE_HUB_TABS).toContain('"venue"');
    // pickHubInitialTab restores a last-viewed Venue tab.
    expect(USE_HUB_TABS).toMatch(/storedTab === "venue"/);
  });
});

describe("ORCH-1145 — Venue pill definition (HubSubNav)", () => {
  // T-5 — pill defined.
  test("T-5 — SUB_TABS contains the venue pill (id, label, route)", () => {
    expect(SUB_NAV).toMatch(
      /\{\s*id:\s*["']venue["'],\s*label:\s*["']Venue["'],\s*route:\s*["']\/\(tabs\)\/hub\/listing["']\s*\}/,
    );
    expect(SUB_NAV).toContain('venue: "Venue"'); // LABELS map
    expect(SUB_NAV).toContain('venue: "/(tabs)/hub/listing"'); // ROUTES map
    expect(SUB_NAV).toMatch(/HubSubTabId\s*=\s*[^;]*["']venue["']/);
  });

  // T-6 — active detection.
  test("T-6 — detectActiveSubTab maps /hub/listing → venue (before the events default)", () => {
    expect(SUB_NAV).toMatch(
      /lower\.includes\(["']\/hub\/listing["']\)\)\s*return\s*["']venue["']/,
    );
    const venueDetectIdx = SUB_NAV.indexOf('return "venue"');
    const defaultIdx = SUB_NAV.indexOf('return "events"');
    expect(venueDetectIdx).toBeGreaterThan(-1);
    expect(venueDetectIdx).toBeLessThan(defaultIdx);
  });
});

describe("ORCH-1145 — content-only Venue tab (no dead tap)", () => {
  // T-9 — tab renders real management content.
  test("T-9 — hub/listing.tsx renders VenueListingContent (real UI, not a placeholder)", () => {
    expect(HUB_TAB).toContain("VenueListingContent");
    expect(HUB_TAB).toContain('chromeMode="tab"');
    // Active brand resolved via useCurrentBrand, NO route param.
    expect(HUB_TAB).toContain("useCurrentBrand");
    expect(HUB_TAB).not.toContain("useLocalSearchParams<{ id");
  });

  // T-10 — null active brand handled without crash.
  test("T-10 — VenueListingContent handles a null brandId (no-venue / no-crash branch)", () => {
    // brandId may be null; the no-venue branch shows the Add-your-venue CTA.
    expect(HUB_TAB).toContain("brand?.id ?? null");
    expect(CONTENT).toContain("brandId: string | null");
    expect(CONTENT).toContain("No listing yet");
    expect(CONTENT).toContain("Add your venue");
  });

  test("the content tab clears the floating BottomNav (insets.bottom + 120, nav-lock pin)", () => {
    expect(CONTENT).toMatch(/insets\.bottom\s*\+\s*120/);
  });
});

describe("ORCH-1145 — layout threads venue visibility, preserves nav-lock", () => {
  test("_layout computes venue flags from currentBrand (no second fetch) + threads them", () => {
    expect(HUB_LAYOUT).toContain("currentBrand?.hasPhysicalLocation === true");
    expect(HUB_LAYOUT).toContain("currentBrand?.placePoolId != null");
    expect(HUB_LAYOUT).toMatch(/useHubVisibleTabs\([^)]*venueVisibility/s);
  });

  test("redirect effect detects /hub/listing → venue while preserving the nav-lock guard", () => {
    // The venue branch was added to the active derivation.
    expect(HUB_LAYOUT).toMatch(/includes\("\/hub\/listing"\)[\s\S]*?["']venue["']/);
    // PRESERVE: the nav-lock guard line is intact (also pinned by
    // hub-layout-nav-lock.test.ts) and precedes router.replace.
    expect(HUB_LAYOUT).toMatch(
      /if\s*\(\s*!activePath\.includes\(["']\/hub\/["']\)\s*\)\s*return/,
    );
    const guardIdx = HUB_LAYOUT.indexOf('!activePath.includes("/hub/")');
    const replaceIdx = HUB_LAYOUT.indexOf(
      "router.replace(`/(tabs)/hub/${initialTab}`",
    );
    expect(guardIdx).toBeGreaterThan(-1);
    expect(replaceIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(replaceIdx);
  });
});

describe("ORCH-1145 — brand-page row removed (fails-on-revert), route preserved", () => {
  // T-7 — row + onListing removed (SPEC §9 safeguard 1 — fails on revert).
  test("T-7 — BrandProfileView has NO Venue listing row and NO onListing prop", () => {
    expect(PROFILE).not.toContain('label: "Venue listing"');
    expect(PROFILE).not.toContain("onListing");
  });

  // T-8 — route preserved as a redirect (SPEC §9 safeguard 3 — fails on delete).
  test("T-8 — /brand/[id]/listing is preserved as a redirect to the Hub tab", () => {
    expect(REDIRECT).toContain("Redirect");
    expect(REDIRECT).toContain("/(tabs)/hub/listing");
    // Forwards ?focus=feedback so the to-do feedback deep-link still auto-opens.
    expect(REDIRECT).toContain("/(tabs)/hub/listing?focus=feedback");
    // Sets the active brand to the deep-linked id (active-brand-scoped tab).
    expect(REDIRECT).toContain("setCurrentBrandId");
  });
});
