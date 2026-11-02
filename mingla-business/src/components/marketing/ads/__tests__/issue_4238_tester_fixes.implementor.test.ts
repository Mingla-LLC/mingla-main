/**
 * #4238 — fixes from the tester's FAIL verdict (Business app side).
 *
 * D2: a draft with no saved platforms starts on every ready platform, on the
 * fresh, restored and not-found paths alike; "Matched on all platforms" never
 * shows with nothing ticked. D4: one Ads setup read per brand while the
 * builder remounts, changes step or resumes a plan (call count), and the
 * builder keeps its place with setParams, never a remounting replace.
 * D5: "Back to Ads" works with no history. D7: the page type shows once.
 * Extra A: the step buttons clear the bottom nav and floating button.
 * D3: review notes and the ad detail page use names and plain result words.
 *
 * Fails on revert: restoring the unticked restore path, a router.replace in
 * the builder, or an uncached setup read reds the matching test.
 */

import fs from "node:fs";
import path from "node:path";

import {
  HOST_AD_FLOATING_ACTION_CLEARANCE,
  hostAdMatchSubtitle,
  hostAdScrollBottomPadding,
  initialHostAdConnections,
} from "../hostAdBuilderRules";
import {
  cachedHostAdSetup,
  clearHostAdSetupCache,
  HOST_AD_SETUP_TTL_MS,
} from "../hostAdSetupCache";
import {
  hostAdCostPerLabel,
  hostAdPlaceList,
  hostAdResultLabel,
  hostAdReviewReason,
  hostAdStepLabel,
  hostAdTargetingNote,
} from "../hostAdCopy";
import { hostAdPageDetails } from "../hostAdPageLabels";

const ROOT = path.resolve(__dirname, "../../../../..");
const read = (relative: string): string =>
  fs.readFileSync(path.join(ROOT, relative), "utf8");
const createRoute = read("app/(tabs)/marketing/ads/create.tsx");

const available = [
  { id: "meta-1", platform: "meta" },
  { id: "snap-1", platform: "snapchat" },
];

describe("#4238 D2 platforms start ticked", () => {
  it("a draft with no saved platforms ticks every available one", () => {
    expect(initialHostAdConnections(available, undefined)).toEqual(available);
    expect(initialHostAdConnections(available, null)).toEqual(available);
    expect(initialHostAdConnections(available, [])).toEqual(available);
    expect(initialHostAdConnections(available, ["snap-1"])).toEqual([available[1]]);
    // Saved platforms that are no longer available fall back to all.
    expect(initialHostAdConnections(available, ["gone"])).toEqual(available);
  });

  it("the fresh, restore and not-found paths all use the one rule", () => {
    expect(createRoute).toContain(
      "initialHostAdConnections(setup.connections, state.connection_ids)",
    );
    expect(
      createRoute.split("initialHostAdConnections(setup.connections, null)").length - 1,
    ).toBe(2);
    const notFound = createRoute.slice(createRoute.indexOf('code === "draft_not_found"'));
    expect(notFound.indexOf("initialHostAdConnections(")).toBeGreaterThan(-1);
    expect(notFound.indexOf("initialHostAdConnections(")).toBeLessThan(
      notFound.indexOf("setDraftReady(true)"),
    );
  });

  it("never says 'Matched on all platforms' with nothing ticked", () => {
    expect(hostAdMatchSubtitle("", 0, 0)).toBe("Turn on at least one app to check this");
    expect(hostAdMatchSubtitle("", 0, 2)).toBe("Matched on all platforms");
    expect(hostAdMatchSubtitle("TikTok", 1, 2)).toContain("Not found on TikTok");
  });
});

describe("#4238 D4 one Ads setup read", () => {
  beforeEach(() => clearHostAdSetupCache());

  it("remounts, step changes and a resumed plan reuse one read", async () => {
    const loader = jest.fn((brandId: string) => Promise.resolve({ brandId }));
    const now = 1_000;
    await Promise.all([
      cachedHostAdSetup("brand-1", loader, { now }),
      cachedHostAdSetup("brand-1", loader, { now }),
    ]);
    for (let step = 0; step < 39; step += 1) {
      await cachedHostAdSetup("brand-1", loader, { now: now + step * 300 });
    }
    expect(loader).toHaveBeenCalledTimes(1);
    await cachedHostAdSetup("brand-1", loader, { now: now + HOST_AD_SETUP_TTL_MS + 1 });
    expect(loader).toHaveBeenCalledTimes(2);
    await cachedHostAdSetup("brand-1", loader, { now: now + HOST_AD_SETUP_TTL_MS + 2, force: true });
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it("never caches a failed read", async () => {
    const loader = jest
      .fn<Promise<string>, [string]>()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue("ok");
    await expect(cachedHostAdSetup("brand-2", loader, { now: 1 })).rejects.toThrow("down");
    await expect(cachedHostAdSetup("brand-2", loader, { now: 2 })).resolves.toBe("ok");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("the builder loads setup through the cache and keeps its place with setParams", () => {
    expect(createRoute).toContain("cachedHostAdSetup(brandId, loadHostAdSetup, { force })");
    expect(createRoute).not.toContain("await loadHostAdSetup(brandId)");
    expect(createRoute).not.toMatch(/router\.replace\(\s*hostAdBuilder/);
    expect(createRoute.split("router.setParams(").length - 1).toBe(4);
  });
});

describe("#4238 D5, D7 and Extra A", () => {
  it("Back to Ads goes to the Ads list when there is no history", () => {
    expect(createRoute).toContain("if (router.canGoBack()) router.back();");
    expect(createRoute).toContain('else router.replace("/(tabs)/marketing/ads" as never);');
    expect(createRoute).toContain('cta={{ label: "Back to Ads", onPress: backToAds }}');
  });

  it("a page card shows its type once (badge), then date and city", () => {
    expect(
      hostAdPageDetails({ page_type: "trip", starts_at: "2026-12-05T12:00:00Z", city: "Lagos" }),
    ).toBe("Sat 5 Dec · Lagos");
    expect(hostAdPageDetails({ page_type: "brand", starts_at: null, city: null })).toBe("");
  });

  it("the step buttons clear the bottom nav and the floating button", () => {
    expect(createRoute).toContain("useStickyFooterOffset()");
    expect(createRoute).toContain(
      "paddingBottom: hostAdScrollBottomPadding(bottomChromeInset)",
    );
    expect(createRoute).toContain("contentContainerStyle={[styles.scroll, scrollBottomStyle]}");
  });
});

describe("#4238 D3 names and plain result words", () => {
  it("review notes name cities and countries", () => {
    expect(hostAdPlaceList("NG:lagos")).toBe("Lagos, Nigeria");
    expect(hostAdPlaceList("NG, GH")).toBe("Nigeria and Ghana");
    expect(
      hostAdTargetingNote("meta", "check_required", "Resolve Meta city keys for: NG:lagos, GH:accra."),
    ).toBe(
      "Facebook & Instagram couldn't find Lagos, Nigeria and Accra, Ghana. Remove it, or turn Facebook & Instagram off.",
    );
    expect(
      hostAdTargetingNote(
        "reddit",
        "broader",
        "Reddit cannot preserve city targeting; the selected countries are broader.",
        ["NG", "GH"],
      ),
    ).toContain("across Nigeria and Ghana");
  });

  it("the ad detail page says sales, visits or results, never conversions", () => {
    expect(hostAdResultLabel("ticket_purchase")).toBe("ticket sales");
    expect(hostAdResultLabel("landing page view")).toBe("page visits");
    expect(hostAdCostPerLabel("ticket_purchase")).toBe("Cost per sale");
    expect(hostAdCostPerLabel("clicks")).toBe("Cost per visit");
    expect(hostAdCostPerLabel("results")).toBe("Cost per result");
    const detail = read("app/(tabs)/marketing/ads/[id].tsx");
    expect(detail).toContain("{costPerLabel}:");
    expect(detail).not.toContain('"conversions"');
    expect(detail).not.toContain("Cost per {primaryResultLabel}");
  });
});

describe("#4238 retest 2: the detail page and Ads list stay reachable", () => {
  const detail = read("app/(tabs)/marketing/ads/[id].tsx");
  const list = read("app/(tabs)/marketing/ads/index.tsx");
  const layout = read("app/(tabs)/marketing/_layout.tsx");

  it("the last button clears the bottom nav and the floating button (390×844)", () => {
    // Hit-test model: at full scroll the last button's bottom edge sits
    // `padding` above the screen bottom. The bottom nav occupies the
    // sticky-footer offset (96 at zero safe area on a phone); the floating
    // action button (up to 56 tall) sits just above it.
    const viewportHeight = 844;
    const navReserve = 96;
    const fabHeight = 56;
    const padding = hostAdScrollBottomPadding(navReserve);
    const lastButtonBottom = viewportHeight - padding;
    const coveredFrom = viewportHeight - navReserve - fabHeight;
    expect(lastButtonBottom).toBeLessThanOrEqual(coveredFrom);
    expect(HOST_AD_FLOATING_ACTION_CLEARANCE).toBeGreaterThanOrEqual(fabHeight);
  });

  it("the detail page and the Ads list pad their scroll content with it", () => {
    for (const source of [detail, list]) {
      expect(source).toContain(
        "const scrollBottomPadding = hostAdScrollBottomPadding(useStickyFooterOffset());",
      );
      expect(source).toContain("{ paddingBottom: scrollBottomPadding },");
    }
    expect(detail).not.toContain("<ScrollView contentContainerStyle={styles.scroll}>");
  });

  it("the floating Create an ad button hides on the builder and the detail page only", () => {
    const re = /\/marketing\/ads\/[^/]+/;
    expect(layout).toContain("HOST_AD_SUBPAGE_RE.test(pathname)");
    expect(layout).toContain(String.raw`const HOST_AD_SUBPAGE_RE = /\/marketing\/ads\/[^/]+/;`);
    expect(re.test("/marketing/ads/create")).toBe(true);
    expect(re.test("/marketing/ads/2f6b0a9e-1111-4111-8111-111111111111")).toBe(true);
    expect(re.test("/marketing/ads")).toBe(false);
    expect(re.test("/marketing")).toBe(false);
  });
});

describe("#4238 retest 2: last plain-language fixes", () => {
  const list = read("app/(tabs)/marketing/ads/index.tsx");

  it("the Ads list says results in plain words", () => {
    expect(list).toContain("{hostAdResultLabel(item.primaryResultLabel)}");
    expect(hostAdResultLabel("conversions")).toBe("results");
    expect(hostAdResultLabel("rsvp_registration")).toBe("RSVPs");
    expect(hostAdCostPerLabel("rsvp_registration")).toBe("Cost per sign-up");
    const server = read("../supabase/functions/_shared/hostAdCampaignList.ts");
    expect(server).toContain('primary_result_label: text(hierarchy[0]) ?? "results"');
  });

  it("a saved draft names its step and a review reason is a sentence", () => {
    expect(hostAdStepLabel("promote")).toBe("What you're promoting");
    expect(hostAdStepLabel("budget")).toBe("Budget and dates");
    expect(hostAdReviewReason("first_three_host_campaigns")).toBe(
      "Mingla checks a brand's first three ads before they run",
    );
    expect(hostAdReviewReason("Please use a brighter video.")).toBe(
      "Please use a brighter video.",
    );
    expect(read("src/services/hostAdLifecycle.ts")).toContain(
      "reason: `Saved at: ${hostAdStepLabel(draft.current_step)}`,",
    );
  });

  it("city chips show the full country name", () => {
    expect(createRoute).toContain("{city.name}, {countryName(city.countryCode)}");
    expect(createRoute).not.toContain("{city.name}, {city.countryCode}");
  });

  it("platform checkboxes expose aria-checked", () => {
    expect(createRoute).toContain("aria-checked={props.multiple ? props.selected : undefined}");
  });
});

describe("#4238 retest 2: sign-out clears the Ads setup cache", () => {
  it("runs on the shared sign-out path", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { runSignOutCleanups } = require("../../../../utils/signOutCleanups") as {
      runSignOutCleanups: () => void;
    };
    const loader = jest.fn((brandId: string) => Promise.resolve(brandId));
    await cachedHostAdSetup("brand-signout", loader, { now: 1 });
    await cachedHostAdSetup("brand-signout", loader, { now: 2 });
    expect(loader).toHaveBeenCalledTimes(1);
    runSignOutCleanups();
    await cachedHostAdSetup("brand-signout", loader, { now: 3 });
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
