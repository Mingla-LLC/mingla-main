/**
 * ORCH-0974 [Home mobile section lock + spacing] tester adversarial tests.
 *
 * The mingla-business Jest harness is intentionally node/ts-jest only: no
 * react-test-renderer, no @testing-library/react-native, and no jsdom. These
 * tests therefore pin the source contracts that produce the runtime behaviour.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), "utf8");

const HOME = read("mingla-business/app/(tabs)/home.tsx");
const UPCOMING_ITEM = read(
  "mingla-business/src/components/home/UpcomingListItem.tsx",
);

const BEGIN = "// orch-0974-lock-pane:begin-mobile-populated";
const END = "// orch-0974-lock-pane:end-mobile-populated";
const LADDER_CONDITION =
  "nextAction !== null && (upcoming.counts.live === 0 || nextAction.rung === 4)";

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
  const end = source.indexOf(`{${LADDER_CONDITION} && isSmallPhoneWithLiveHero`, start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function callbackBlock(name: string): string {
  const start = HOME.indexOf(`const ${name} = useCallback`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = HOME.indexOf("\n  );", start);
  expect(end).toBeGreaterThan(start);
  return HOME.slice(start, end);
}

function compact(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function emptyMobileBranch(): string {
  const start = HOME.indexOf(") : currentBrand === null ? (");
  const end = HOME.indexOf(BEGIN);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return HOME.slice(start, end);
}

function ladderPlacement(
  rung: 1 | 2 | 3 | 4,
  liveCount: 0 | 1,
  smallPhone: boolean,
): "locked" | "foot" | "none" {
  const baseCondition = liveCount === 0 || rung === 4;
  if (!baseCondition) return "none";
  return liveCount > 0 && smallPhone ? "foot" : "locked";
}

describe("ORCH-0974 Home adversarial contracts", () => {
  test("A-01: populated FlatList pull-to-refresh still invalidates brand, orders, and upcoming keys", () => {
    const flatList = mobileFlatListBlock();
    const refreshBlock = callbackBlock("handleRefresh");

    expect(flatList).toContain("refreshControl=");
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

  test("A-02: populated empty upcoming list renders the no-events GlassCard inside FlatList", () => {
    const flatList = mobileFlatListBlock();

    expect(flatList).toContain("ListEmptyComponent=");
    expect(flatList).toContain('<GlassCard variant="base" padding={spacing.lg}>');
    expect(flatList).toContain("<Text style={styles.emptyTitle}>No upcoming events</Text>");
    expect(flatList).toContain('<Text style={styles.emptyEmphasis}>+</Text>');
    expect(flatList).toContain("in the top right to create your first event");
  });

  test("A-03: empty brand path never renders the ladder action even when a rung exists", () => {
    const empty = emptyMobileBranch();

    expect(empty).toContain("<ScrollView");
    expect(empty).toContain("<View style={styles.emptyCol}>");
    expect(empty).not.toContain("HomeNextActionCard");
    expect(empty).not.toContain(LADDER_CONDITION);
  });

  test("A-04: ORCH-0965 ladder gate is preserved across rung/live/small-phone matrix", () => {
    const mobile = compact(scopedMobilePopulated());
    const lockedCondition = compact(`${LADDER_CONDITION} && !isSmallPhoneWithLiveHero`);
    const footCondition = compact(`${LADDER_CONDITION} && isSmallPhoneWithLiveHero`);

    expect(mobile).toContain(lockedCondition);
    expect(mobile).toContain(footCondition);

    const cases = ([1, 2, 3, 4] as const).flatMap((rung) =>
      ([0, 1] as const).flatMap((liveCount) =>
        [false, true].map((smallPhone) => ({
          rung,
          liveCount,
          smallPhone,
          placement: ladderPlacement(rung, liveCount, smallPhone),
        })),
      ),
    );

    expect(cases).toEqual([
      { rung: 1, liveCount: 0, smallPhone: false, placement: "locked" },
      { rung: 1, liveCount: 0, smallPhone: true, placement: "locked" },
      { rung: 1, liveCount: 1, smallPhone: false, placement: "none" },
      { rung: 1, liveCount: 1, smallPhone: true, placement: "none" },
      { rung: 2, liveCount: 0, smallPhone: false, placement: "locked" },
      { rung: 2, liveCount: 0, smallPhone: true, placement: "locked" },
      { rung: 2, liveCount: 1, smallPhone: false, placement: "none" },
      { rung: 2, liveCount: 1, smallPhone: true, placement: "none" },
      { rung: 3, liveCount: 0, smallPhone: false, placement: "locked" },
      { rung: 3, liveCount: 0, smallPhone: true, placement: "locked" },
      { rung: 3, liveCount: 1, smallPhone: false, placement: "none" },
      { rung: 3, liveCount: 1, smallPhone: true, placement: "none" },
      { rung: 4, liveCount: 0, smallPhone: false, placement: "locked" },
      { rung: 4, liveCount: 0, smallPhone: true, placement: "locked" },
      { rung: 4, liveCount: 1, smallPhone: false, placement: "locked" },
      { rung: 4, liveCount: 1, smallPhone: true, placement: "foot" },
    ]);
  });

  test("A-05: populated mobile list preserves draft, trip, and live-event item branches", () => {
    const flatList = mobileFlatListBlock();
    const branchDigest = {
      flatList: {
        data: flatList.includes("data={upcoming.items}"),
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
          "<Pill variant=\"draft\">Draft</Pill>",
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

    expect(branchDigest).toMatchInlineSnapshot(`
{
  "flatList": {
    "data": true,
    "handlers": [
      "onOpenDraft={handleOpenDraft}",
      "onOpenTrip={handleOpenTrip}",
      "onOpenLiveEvent={handleOpenLiveEvent}",
    ],
    "keyExtractor": true,
    "renderItem": true,
  },
  "upcomingListItem": {
    "draft": [
      "item.kind === "draft"",
      "Resume draft:",
      "<Pill variant="draft">Draft</Pill>",
      "lastStepReached + 1",
    ],
    "event": [
      "const event = item.source as LiveEvent",
      "variant={isLive ? "live" : "accent"}",
      "isLive ? "Live" : "Upcoming"",
      "revenueLabel",
      "onOpenLiveEvent(event)",
    ],
    "trip": [
      "item.kind === "trip"",
      "<HomeTripRow",
      "status={item.status === "live" ? "live" : "upcoming"}",
    ],
  },
}
`);
  });
});
