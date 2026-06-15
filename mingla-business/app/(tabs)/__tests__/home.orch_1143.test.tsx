/**
 * ORCH-1143 [business Home live-card: scan parity + accordion + carousel].
 *
 * Source-level contract tests (node/ts-jest — the default biz-app jest config
 * has no RN renderer + no RTL; render proofs are segregated to dedicated
 * configs, see jest.config.cjs). These lock the runtime behaviour by pinning
 * the source contracts that produce it:
 *
 *   - the live carousel/single-card maps off `upcoming.liveItems` (all kinds),
 *   - it renders the reusable <LiveOfferingCard> (no inline event-only hero),
 *   - <LiveOfferingCard> emits the scan button UNCONDITIONALLY (no per-kind
 *     gate) → experience + trip live offerings are scannable (the bug),
 *   - the scan handler routes EVERY kind to /event/{id}/scanner with NO
 *     `kind === "event"` guard,
 *   - the collapse store is persisted + hasHydrated-gated (Constitution #14).
 *
 * The fails-on-revert contract (§9 / T10): re-introducing a `kind === "event"`
 * gate around the scan affordance, or scoping the carousel to events, or
 * deleting the <LiveOfferingCard> map, makes T10 / T2 / T3 FAIL.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), "utf8");

const HOME = read("mingla-business/app/(tabs)/home.tsx");
const CARD = read("mingla-business/src/components/home/LiveOfferingCard.tsx");
const STORE = read(
  "mingla-business/src/store/liveSectionCollapseStore.ts",
);
const CLEAR = read("mingla-business/src/utils/clearAllStores.ts");

function countToken(source: string, token: string): number {
  return source.split(token).length - 1;
}

describe("ORCH-1143 — live carousel maps off liveItems (all kinds)", () => {
  test("T-SC2: the carousel maps off upcoming.liveItems (one-owner-per-truth), not re-derived", () => {
    // home consumes liveItems from the hook (the builder owns live-state).
    expect(HOME).toContain("const liveItems = upcoming.liveItems;");
    // the carousel iterates the live set
    expect(HOME).toContain("liveItems.map((liveItem)");
    // both branches render the reusable card
    expect(countToken(HOME, "<LiveOfferingCard")).toBeGreaterThanOrEqual(2);
  });

  test("T-SC3: ≥2 live → horizontal ScrollView with snap; exactly 1 live → single full-width card", () => {
    expect(HOME).toContain("liveItems.length === 1 ? (");
    expect(HOME).toContain("snapToInterval={liveCardWidth + spacing.md}");
    expect(HOME).toContain('decelerationRate="fast"');
    // single-live card has NO width prop (full-width); carousel cards do.
    expect(HOME).toContain("width={liveCardWidth}");
  });

  test("T6/SC-4: accordion header toggles via LayoutAnimation easeInEaseOut + chevron glyph swap + expanded state", () => {
    expect(HOME).toContain(
      "LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)",
    );
    expect(HOME).toContain('name={showLiveOpen ? "chevU" : "chevD"}');
    expect(HOME).toContain("accessibilityState={{ expanded: !liveCollapsed }}");
    // Android guard for LayoutAnimation present (module top).
    expect(HOME).toContain(
      "UIManager.setLayoutAnimationEnabledExperimental(true)",
    );
  });

  test("SC-5/#14: collapse render is hydration-gated (no flash-of-wrong-state)", () => {
    expect(HOME).toContain(
      "const showLiveOpen = !liveHasHydrated || !liveCollapsed;",
    );
  });
});

describe("ORCH-1143 — scan parity on EVERY live kind (T10 fails-on-revert)", () => {
  test("T1/T9: scan handler routes EVERY kind to /event/{id}/scanner with NO kind gate", () => {
    // handler takes an id and pushes the shared scanner route.
    expect(HOME).toContain("router.push(`/event/${id}/scanner` as never)");
    // NO event-only gate on the scan affordance anywhere in home.
    expect(HOME).not.toContain("primaryLiveItem.kind === \"event\"");
    expect(HOME).not.toContain("showScanAction");
  });

  test("T10 (fails-on-revert): <LiveOfferingCard> emits the scan button UNCONDITIONALLY (no per-kind gate)", () => {
    // The scan button is present in the card.
    expect(CARD).toContain('testID="home-live-card-scan-button"');
    expect(CARD).toContain("Scan QR codes");
    expect(CARD).toContain("onScanPress(item.id)");
    // There is NO event-type gate inside the card — it renders for every kind.
    expect(CARD).not.toContain('item.kind === "event"');
    expect(CARD).not.toContain('event_type === "event"');
    // The button is NOT wrapped in a conditional ternary keyed on kind: it is a
    // direct child of the card (the structural safeguard from §9). If a future
    // edit re-gates the carousel to events only, T-SC2's two-card map + the
    // builder T2/T3 (experience/trip → liveItems) fail.
  });

  test("T2/T3: an experience and a trip live offering reach the carousel (no kind filter)", () => {
    // home builds the live views over liveItems with trips adapted (NOT
    // filtered to events). Reverting to event-only would delete this map.
    expect(HOME).toContain("tripToLiveEvent(i.source as Trip)");
    expect(HOME).toContain("(i.source as LiveEvent)");
    // liveEventViews is derived from liveItems, not from an event-only filter.
    expect(HOME).toContain("liveItems\n        .map((i)");
  });
});

describe("ORCH-1143 — honest data + currency (SC-6)", () => {
  test("SC-6: Scanned tile stays '—' (Constitution #9), revenue is currency-aware", () => {
    // Scanned cell is the honest-empty dash; never a fabricated number.
    expect(CARD).toContain("<Text style={styles.statValue}>—</Text>");
    expect(CARD).toContain("Scanned");
    // revenue uses the offering currency ?? brand default (no NEW hardcoded GBP
    // introduced by this ORCH; the metricsById builder threads currency).
    expect(HOME).toContain(
      "view.currency ?? currentBrand?.defaultCurrency ?? \"GBP\"",
    );
  });
});

describe("ORCH-1143 — collapse store (SC-5/SC-8, Constitution #14/#6)", () => {
  test("store is persisted, partialized to collapsed only, hasHydrated NOT persisted", () => {
    expect(STORE).toContain('name: "mingla-business.liveSectionCollapse.v1"');
    expect(STORE).toContain("partialize: (state) => ({ collapsed: state.collapsed })");
    expect(STORE).toContain("hasHydrated: false");
    expect(STORE).toContain(
      "useLiveSectionCollapseStore.getState().setHasHydrated(true)",
    );
    // hasHydrated is NOT in the persisted partition.
    expect(STORE).not.toContain("hasHydrated: state.hasHydrated");
  });

  test("SC-8: reset is wired into clearAllStores (logout cascade, Constitution #6)", () => {
    expect(CLEAR).toContain(
      "useLiveSectionCollapseStore.getState().reset()",
    );
  });
});
