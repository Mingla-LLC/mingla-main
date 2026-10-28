/**
 * #4037 keeps ORCH-1143 scan parity while moving live presentation into the
 * unified Business Pulse panel. These source contracts fail if Home restores
 * the retired accordion or narrows scanning back to event-only.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), "utf8");

const HOME = read("mingla-business/app/(tabs)/home.tsx");
const PULSE = read(
  "mingla-business/src/components/home/BusinessPulsePanel.tsx",
);
const STORE = read("mingla-business/src/store/liveSectionCollapseStore.ts");
const CLEAR = read("mingla-business/src/utils/clearAllStores.ts");

describe("#4037 — Home delegates all live kinds to Business Pulse", () => {
  test("the panel receives the canonical live and upcoming sets", () => {
    expect(HOME).toContain("const liveItems = upcoming.liveItems;");
    expect(HOME).toContain("<BusinessPulsePanel");
    expect(HOME).toContain("liveItems={liveItems}");
    expect(HOME).toContain("upcomingItems={upcoming.items}");
    expect(HOME).toContain("liveMetricsById={liveMetricsById}");
  });

  test("the retired Live now accordion and sizing rail stay removed", () => {
    expect(HOME).not.toContain("useLiveSectionCollapseStore");
    expect(HOME).not.toContain("renderLiveSection");
    expect(HOME).not.toContain("LIVE_CARD_PEEK");
    expect(HOME).not.toContain("LIVE_CARD_MAX");
    expect(HOME).not.toContain("<LiveOfferingCard");
  });

  test("two-live desktop tabs and phone swipe paging live inside the band", () => {
    expect(PULSE).toContain("liveItems.length > 1");
    expect(PULSE).toContain('accessibilityRole="tab"');
    expect(PULSE).toContain("pagingEnabled");
    expect(PULSE).toContain("onMomentumScrollEnd={onScrollEnd}");
    expect(PULSE).toContain("pageCount={`${index + 1} of ${items.length}`}");
  });
});

describe("#4037 / ORCH-1143 — scan parity on every live kind", () => {
  test("Home routes RSVP to its scanner and all ticketed kinds to the shared scanner", () => {
    expect(HOME).toContain('?.event_type === "rsvp"');
    expect(HOME).toContain("? `/rsvp/${id}/scanner`");
    expect(HOME).toContain(": `/event/${id}/scanner`");
    expect(HOME).not.toContain('primaryLiveItem.kind === "event"');
    expect(HOME).not.toContain("showScanAction");
  });

  test("the live band invokes scan without an event-kind gate", () => {
    expect(PULSE).toContain(": onScanPress(item.id)");
    expect(PULSE).toContain('rsvp ? "Scan guests" : "Scan tickets"');
    expect(PULSE).not.toContain('item.kind === "event"');
    expect(PULSE).not.toContain('item.kind === "experience"');
  });

  test("trip metrics still adapt through the common LiveEvent view", () => {
    expect(HOME).toContain("tripToLiveEvent(i.source as Trip)");
    expect(HOME).toContain("(i.source as LiveEvent)");
  });
});

describe("ORCH-1143 — the retained store still obeys reset invariants", () => {
  test("the unused-on-Home store remains persisted because logout still imports it", () => {
    expect(STORE).toContain('name: "mingla-business.liveSectionCollapse.v1"');
    expect(STORE).toContain(
      "partialize: (state) => ({ collapsed: state.collapsed })",
    );
    expect(CLEAR).toContain("useLiveSectionCollapseStore.getState().reset()");
  });
});
