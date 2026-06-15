/**
 * ORCH-1145 nav-away fix — Hub nav-lock redirect must resolve to a REAL route.
 *
 * Root cause (INVESTIGATE_ORCH-1145_NAV_AWAY_CRASH.md, F-1): ORCH-1145 widened
 * `HubTabName` with `"venue"`, but the Venue tab's route FILE is `listing.tsx`
 * (route `/(tabs)/hub/listing`), NOT `venue.tsx`. The Hub layout's nav-lock
 * redirect string-concatenated the bare tab name (`/(tabs)/hub/${initialTab}`),
 * so a picked `"venue"` built the non-existent `/(tabs)/hub/venue` → expo-router
 * served `app/+not-found.tsx` (the branded 404).
 *
 * The fix resolves the picked tab through `HUB_TAB_ROUTES` (the SAME map
 * HubSubNav uses) before redirecting — single source of truth, where
 * `venue → /(tabs)/hub/listing`.
 *
 * This is the fails-on-revert contract for the implicit invariant
 * "every HubTabName the nav-lock redirect can target resolves to an EXISTING
 * app/(tabs)/hub/* route file." It parses `HUB_TAB_ROUTES` from source (the biz
 * harness is node/ts-jest with NO React Native renderer, so importing
 * HubSubNav.tsx — which pulls RN JSX — is not possible; see the same note in
 * `venueTab.contract.test.ts`/`hub-layout-nav-lock.test.ts`). For every
 * HubTabName it asserts the corresponding route file exists. If someone reverts
 * the fix to bare-name concatenation, the `venue → venue.tsx` case fails (no
 * `venue.tsx` exists). APPEND-ONLY — do not weaken.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

// __dirname = app/(tabs)/hub/__tests__ → the hub route dir is one level up; the
// biz root is four levels up.
const HUB_DIR = join(__dirname, "..");
const biz = (rel: string): string =>
  readFileSync(join(__dirname, "../../../..", rel), "utf8");

const LAYOUT = readFileSync(join(HUB_DIR, "_layout.tsx"), "utf8");
const SUB_NAV = biz("src/components/hub/HubSubNav.tsx");

/**
 * Parse the exported HUB_TAB_ROUTES map from HubSubNav.tsx source (the single
 * source of truth the layout redirect resolves through). Returns
 * { tabName: route } pairs, e.g. { venue: "/(tabs)/hub/listing" }.
 */
function parseHubTabRoutes(): Record<string, string> {
  const block = SUB_NAV.match(
    /HUB_TAB_ROUTES\s*:\s*Record<[^>]*>\s*=\s*\{([\s\S]*?)\}/,
  );
  if (block === null) {
    throw new Error("HUB_TAB_ROUTES map not found in HubSubNav.tsx source");
  }
  const routes: Record<string, string> = {};
  const entryRe = /(\w+)\s*:\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(block[1])) !== null) {
    routes[m[1]] = m[2];
  }
  return routes;
}

const HUB_TAB_ROUTES = parseHubTabRoutes();
// Every value the nav-lock redirect can resolve to is a HubTabName — exactly the
// keys of HUB_TAB_ROUTES (getstarted/events/trips/experiences/venue).
const ALL_HUB_TAB_NAMES = Object.keys(HUB_TAB_ROUTES);

/** Map a HUB_TAB_ROUTES value (e.g. "/(tabs)/hub/listing") to its route FILE. */
function routeFileFor(tabName: string): string {
  const segment = HUB_TAB_ROUTES[tabName].replace("/(tabs)/hub/", "");
  return join(HUB_DIR, `${segment}.tsx`);
}

describe("ORCH-1145 nav-away — every HubTabName redirect target is a real route file", () => {
  test("the route map was parsed and is non-empty (incl. venue)", () => {
    expect(ALL_HUB_TAB_NAMES.length).toBeGreaterThanOrEqual(5);
    expect(ALL_HUB_TAB_NAMES).toContain("venue");
  });

  test.each(ALL_HUB_TAB_NAMES)(
    "tab '%s' resolves to an EXISTING app/(tabs)/hub/*.tsx route file",
    (tabName) => {
      expect(existsSync(routeFileFor(tabName))).toBe(true);
    },
  );

  test("venue resolves to listing.tsx specifically (NOT venue.tsx)", () => {
    // The exact regression: bare-name concat would target /hub/venue (no file).
    expect(HUB_TAB_ROUTES.venue).toBe("/(tabs)/hub/listing");
    expect(existsSync(join(HUB_DIR, "listing.tsx"))).toBe(true);
    expect(existsSync(join(HUB_DIR, "venue.tsx"))).toBe(false);
  });
});

describe("ORCH-1145 nav-away — the layout redirect resolves THROUGH the route map", () => {
  test("_layout.tsx resolves the picked tab through HUB_TAB_ROUTES, not the bare name", () => {
    // Reverting to bare-name concatenation (dropping the HUB_TAB_ROUTES
    // resolution) makes BOTH assertions fail — the redirect would once again
    // build /(tabs)/hub/venue from the bare HubTabName.
    expect(LAYOUT).toContain("HUB_TAB_ROUTES");
    expect(LAYOUT).toMatch(/HUB_TAB_ROUTES\[targetTab\]/);
  });
});
