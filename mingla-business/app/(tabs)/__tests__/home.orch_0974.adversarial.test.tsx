/**
 * ORCH-0974 Home adversarial contracts — UPDATED for ORCH-1038 [to-do toggle].
 *
 * node/ts-jest only (no RN renderer); pins the source contracts that produce the
 * runtime behaviour. ORCH-1038 removed the rule-ladder card, the empty-state
 * cards, and the FlatList's "No upcoming events" placeholder, replacing them with
 * the shared <BusinessTodoToggle> + data-gated analytics. These adversarial checks
 * lock the new invariants and guard against the old ones creeping back.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), "utf8");

const HOME = read("mingla-business/app/(tabs)/home.tsx");
const UPCOMING_ITEM = read(
  "mingla-business/src/components/home/UpcomingListItem.tsx",
);

const BEGIN = "// orch-0974-lock-pane:begin-mobile-populated";
const END = "// orch-0974-lock-pane:end-mobile-populated";

function scopedMobilePopulated(): string {
  const begin = HOME.indexOf(BEGIN);
  const end = HOME.indexOf(END);
  expect(begin).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(begin);
  return HOME.slice(begin, end);
}

function mobileFlatListBlock(): string {
  const source = scopedMobilePopulated();
  const start = source.indexOf("<FlatList");
  expect(start).toBeGreaterThanOrEqual(0);
  return source.slice(start);
}

function callbackBlock(name: string): string {
  const start = HOME.indexOf(`const ${name} = useCallback`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = HOME.indexOf("\n  );", start);
  expect(end).toBeGreaterThan(start);
  return HOME.slice(start, end);
}

describe("ORCH-1038 Home adversarial contracts", () => {
  test("A-01: populated FlatList pull-to-refresh still invalidates brand, orders, and upcoming keys", () => {
    const flatList = mobileFlatListBlock();
    const refreshBlock = callbackBlock("handleRefresh");

    expect(flatList).toContain(
      "<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />",
    );
    expect(refreshBlock).toContain(
      "queryClient.invalidateQueries({ queryKey: brandKeys.all })",
    );
    expect(refreshBlock).toContain(
      "queryClient.invalidateQueries({ queryKey: eventOrdersKeys.all })",
    );
    expect(refreshBlock).toContain(
      "queryClient.invalidateQueries({ queryKey: upcomingKeys.all })",
    );
  });

  test("A-02: analytics are data-gated and the FlatList has NO empty placeholder", () => {
    const scoped = scopedMobilePopulated();
    // gates present
    expect(scoped).toContain("{showKpiGrid ? (");
    expect(scoped).toContain("{showRevenueTile ? (");
    expect(scoped).toContain("{hasActiveEvents ? (");
    expect(scoped).toContain("{hasUpcomingItems ? (");
    // the old zero/empty placeholder is gone — the to-do toggle carries guidance
    const flatList = mobileFlatListBlock();
    expect(flatList).not.toContain("ListEmptyComponent");
    expect(flatList).not.toContain("No upcoming events");
  });

  test("A-03: to-do action dispatch is exhaustive (switcher / creator / route + never default)", () => {
    const block = callbackBlock("handleTodoAction");
    expect(block).toContain('case "open_brand_switcher":');
    expect(block).toContain("setSheetVisible(true)");
    expect(block).toContain('case "open_universal_creator":');
    expect(block).toContain("setIsUniversalCreatorOpen(true)");
    expect(block).toContain('case "route":');
    expect(block).toContain("router.push(todo.action.route as never)");
    expect(block).toContain("const _exhaustive: never = todo.action");
  });

  test("A-04: the old conditional-card derivations do not return", () => {
    expect(HOME).not.toContain("showNoVenueEntry");
    expect(HOME).not.toContain("showDeckReadinessEntry");
    expect(HOME).not.toContain("isSmallPhoneWithLiveHero");
    expect(HOME).not.toContain("handleNextActionPress");
    expect(HOME).not.toContain("handleOfferingSelect");
    expect(HOME).not.toContain("pickHomeNextAction");
  });

  test("A-05: populated mobile list preserves draft, trip, and live-event item branches", () => {
    const flatList = mobileFlatListBlock();
    const branchDigest = {
      flatList: {
        // ORCH-1143 SC-7 [TEST-MOD-APPROVED by Seth 2026-06-15]: Upcoming list excludes live items (now in the Live-now carousel); single-scroll + all item-kind branches still asserted.
        data: flatList.includes("data={upcoming.nonLiveItems}"),
        keyExtractor: flatList.includes("keyExtractor={(item) => item.key}"),
        renderItem: flatList.includes("<UpcomingListItem"),
        handlers: [
          "onOpenDraft={handleOpenDraft}",
          "onOpenTrip={handleOpenTrip}",
          "onOpenLiveEvent={handleOpenLiveEvent}",
        ].filter((token) => flatList.includes(token)),
      },
      upcomingListItem: {
        draft: [
          'item.kind === "draft"',
          "Resume draft:",
          '<Pill variant="draft">Draft</Pill>',
          "lastStepReached + 1",
        ].filter((token) => UPCOMING_ITEM.includes(token)),
        trip: [
          'item.kind === "trip"',
          "<HomeTripRow",
          'status={item.status === "live" ? "live" : "upcoming"}',
        ].filter((token) => UPCOMING_ITEM.includes(token)),
        event: [
          "const event = item.source as LiveEvent",
          'variant={isLive ? "live" : "accent"}',
          'isLive ? "Live" : "Upcoming"',
          "revenueLabel",
          "onOpenLiveEvent(event)",
        ].filter((token) => UPCOMING_ITEM.includes(token)),
      },
    };

    expect(branchDigest.flatList).toEqual({
      data: true,
      keyExtractor: true,
      renderItem: true,
      handlers: [
        "onOpenDraft={handleOpenDraft}",
        "onOpenTrip={handleOpenTrip}",
        "onOpenLiveEvent={handleOpenLiveEvent}",
      ],
    });
    expect(branchDigest.upcomingListItem.draft).toHaveLength(4);
    expect(branchDigest.upcomingListItem.trip).toHaveLength(3);
    expect(branchDigest.upcomingListItem.event).toHaveLength(5);
  });
});
