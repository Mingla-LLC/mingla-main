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
  goBackToAds,
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
  hostAdCountingLines,
  hostAdLedgerLabel,
  hostAdPlaceList,
  hostAdPlaceName,
  hostAdResultLabel,
  hostAdReviewReason,
  hostAdStepLabel,
  hostAdTargetingNote,
} from "../hostAdCopy";
import { hostAdPageDetails } from "../hostAdPageLabels";
import { formatHostAdMoneyCents } from "../hostAdMoney";

const ROOT = path.resolve(__dirname, "../../../../..");
const read = (relative: string): string =>
  fs.readFileSync(path.join(ROOT, relative), "utf8");
const createRoute = read("src/screens/hostAds/HostAdCreateScreen.tsx");

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
    // #4238 retest 4: the fallback now lives in the shared goBackToAds helper.
    const rules = read("src/components/marketing/ads/hostAdBuilderRules.ts");
    expect(rules).toContain("if (router.canGoBack()) router.back();");
    expect(rules).toContain("else router.replace(HOST_ADS_LIST_HREF as never);");
    expect(createRoute).toContain("goBackToAds(router)");
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
    const detail = read("src/screens/hostAds/HostAdDetailScreen.tsx");
    // #4238 rework 2: the line is built by hostAdCostPerResultLine (code, not symbol).
    expect(detail).toContain("{hostAdCostPerResultLine(costPerLabel, costPerResult)}");
    expect(detail).not.toContain('"conversions"');
    expect(detail).not.toContain("Cost per {primaryResultLabel}");
  });
});

describe("#4238 retest 2: the detail page and Ads list stay reachable", () => {
  const detail = read("src/screens/hostAds/HostAdDetailScreen.tsx");
  const list = read("src/screens/hostAds/HostAdListScreen.tsx");
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
  const list = read("src/screens/hostAds/HostAdListScreen.tsx");

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

describe("#4238 retest 3: Ari card money and result labels, city rows, ready status", () => {
  /** Every result kind the server can send, raw and already-plain. */
  function serverResultKinds(): string[] {
    const measurement = read("../supabase/functions/_shared/adMeasurement.ts");
    const hierarchy = measurement.slice(
      measurement.indexOf("const RESULT_HIERARCHY"),
      measurement.indexOf("};", measurement.indexOf("const RESULT_HIERARCHY")),
    );
    const raw = [...hierarchy.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    const keys = [...hierarchy.matchAll(/^\s+([a-z_]+):/gm)].map((m) => m[1]);
    const ari = read("../supabase/functions/_shared/agentDomainTools.ts");
    const words = ari.slice(
      ari.indexOf("const AD_RESULT_WORDS"),
      ari.indexOf("};", ari.indexOf("const AD_RESULT_WORDS")),
    );
    const plain = [...words.matchAll(/: "([^"]+)"/g)].map((m) => m[1]);
    const wordKeys = [...words.matchAll(/^\s+([a-z_]+):/gm)].map((m) => m[1]);
    return [...new Set([...raw, ...keys, ...plain, ...wordKeys, "results", "conversions"])];
  }

  it("every result kind shows a plain label, never a raw lowercase key", () => {
    const kinds = serverResultKinds();
    expect(kinds.length).toBeGreaterThan(15);
    const plainLabels = new Set([
      "ticket sales",
      "sign-ups",
      "RSVPs",
      "bookings",
      "page visits",
      "results",
      "checkouts started",
      "app installs",
      "app store visits",
    ]);
    for (const kind of kinds) {
      const label = hostAdResultLabel(kind);
      expect(plainLabels.has(label) ? label : `${kind} → ${label}`).toBe(label);
      expect(label).not.toMatch(/_/);
    }
    expect(hostAdResultLabel("RSVPs")).toBe("RSVPs");
    expect(hostAdResultLabel("rsvps")).toBe("RSVPs");
  });

  it("the Ari card passes the server's result word straight to the label", () => {
    const card = read("src/components/ari/ToolProposalCard.tsx");
    // The server writes ad_result in plain words (adResultWords); the card
    // shows it as given and no longer loads the Host Ads words module (#4238
    // boot-chunk fix), so it must not re-map or mangle it.
    expect(card).toContain('out.push({ label: "What we count", value: context.ad_result });');
    expect(card).not.toContain("marketing/ads/hostAdCopy");
    expect(card).not.toContain('context.ad_result.replace(/ /g, "_")');
  });

  it("Ari card money reads NGN 1,500,000.00, the server's format", () => {
    expect(formatHostAdMoneyCents(150_000_000, "NGN")).toBe("NGN 1,500,000.00");
    expect(formatHostAdMoneyCents(25_000, "gbp")).toBe("GBP 250.00");
    const card = read("src/components/ari/ToolProposalCard.tsx");
    // #4238: the card formats with this same function, loaded on intent from
    // the Host Ads chunk (useHostAdCardWords), never imported into the card.
    expect(card).toContain("return words.formatMoney(cents, currency);");
    expect(card).not.toContain("marketing/ads/hostAdMoney");
    const loader = read("src/hooks/useHostAdCardWords.ts");
    expect(loader).toContain("formatMoney: kit.formatHostAdMoneyCents,");
    expect(card).not.toContain("verified settlement currency on save");
  });

  it("city search rows spell out the country", () => {
    expect(hostAdPlaceName("Lagos, Lagos State, NG")).toBe("Lagos, Lagos State, Nigeria");
    expect(hostAdPlaceName("Accra")).toBe("Accra");
    expect(createRoute).toContain("{hostAdPlaceName(result.name)}");
  });

  it("an approved ad waiting for LAUNCH reads Ready to start, not Draft", () => {
    const lifecycle = read("src/services/hostAdLifecycle.ts");
    expect(lifecycle).toContain('{ statusLabel: "Ready to start" }');
    const list = read("src/screens/hostAds/HostAdListScreen.tsx");
    expect(list).toContain("{item.statusLabel ?? LIFECYCLE_LABEL[item.lifecycle]}");
  });
});

describe("#4238 retest 4: back link, ledger words, counting lines, card title", () => {
  function fakeRouter(canGoBack: boolean) {
    return {
      canGoBack: jest.fn(() => canGoBack),
      back: jest.fn(),
      replace: jest.fn(),
    };
  }

  it("← Ads goes back with history, and to the Ads list without it", () => {
    const withHistory = fakeRouter(true);
    goBackToAds(withHistory);
    expect(withHistory.back).toHaveBeenCalledTimes(1);
    expect(withHistory.replace).not.toHaveBeenCalled();
    const fresh = fakeRouter(false);
    goBackToAds(fresh);
    expect(fresh.back).not.toHaveBeenCalled();
    expect(fresh.replace).toHaveBeenCalledWith("/(tabs)/marketing/ads");
  });

  it("the detail page and the builder both use the shared back helper", () => {
    const detail = read("src/screens/hostAds/HostAdDetailScreen.tsx");
    expect(detail).toContain("onPress={() => goBackToAds(router)}");
    expect(detail).not.toContain("router.back()");
    expect(createRoute).toContain("const backToAds = useCallback(() => goBackToAds(router), [router]);");
  });

  it("every Ads credit history kind has a plain label; unknown kinds never show their code", () => {
    expect(hostAdLedgerLabel("top_up")).toBe("Credit added");
    expect(hostAdLedgerLabel("withdraw")).toBe("Credit withdrawn");
    expect(hostAdLedgerLabel("unspend_return")).toBe("Returned to credit");
    expect(hostAdLedgerLabel("campaign_spend")).toBe("Set aside for an ad");
    expect(hostAdLedgerLabel("future_kind_x")).toBe("Ads credit change");
    expect(hostAdLedgerLabel(null)).toBe("Ads credit change");
    const row = read("src/components/marketing/AdCreditLedgerRow.tsx");
    expect(row).toContain("const kindLabel = hostAdLedgerLabel;");
    expect(row).not.toContain("return kind;");
    // Every kind the database allows has its own label.
    const migration = read(
      "../supabase/migrations/20270825003697_issue_3697_wave7c_ads_host.sql",
    );
    const allowed = migration
      .slice(migration.indexOf("ad_credit_ledger_entry_kind_check CHECK"))
      .split(")")[1];
    for (const kind of [...allowed.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])) {
      expect(hostAdLedgerLabel(kind)).not.toBe("Ads credit change");
    }
  });

  it("the review step lists each result once and an RSVP ad never says 'every sale'", () => {
    const rsvp = hostAdCountingLines(["rsvp_registration", "landing_page_view", "click"]);
    expect(rsvp.counts).toBe("We count RSVPs, then page visits.");
    expect(rsvp.sharing).toContain("count every RSVP.");
    expect(rsvp.sharing).not.toContain("sale");
    const tickets = hostAdCountingLines(["ticket_purchase", "checkout_started", "landing_page_view", "click"]);
    expect(tickets.counts).toBe("We count ticket sales, then checkouts started, then page visits.");
    expect(tickets.sharing).toContain("count every sale.");
    expect(hostAdCountingLines([]).counts).toBe("We count the results Mingla can see.");
    expect(createRoute).toContain(").counts");
    expect(createRoute).not.toContain("still count every sale");
  });

  it("the Ari LAUNCH card has a plain title", () => {
    const card = read("src/components/ari/ToolProposalCard.tsx");
    expect(card).toContain('if (toolName === "approve_ad_plan") return "Start this ad";');
  });
});
