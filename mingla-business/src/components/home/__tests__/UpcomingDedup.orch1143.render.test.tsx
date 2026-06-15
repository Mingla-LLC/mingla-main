/**
 * ORCH-1143 SC-7 — Upcoming/Live de-duplication RENDER proof (TESTER adversarial).
 *
 * Attacks SC-7 at a DIFFERENT ANGLE than the implementor's source-level
 * `upcomingBuilder.test.ts` regression (which asserts on the PURE
 * `buildUpcomingItems().nonLiveItems` array). This test mounts a faithful
 * @testing-library/react-native render slice that mirrors `home.tsx`'s actual
 * wiring:
 *   - the "Live now" carousel: `liveItems.map(...)` -> <LiveOfferingCard>
 *   - the "Upcoming" FlatList:  `data={upcoming.nonLiveItems ?? upcoming.items}`
 *     -> <UpcomingListItem>  (home.tsx binds `data={upcoming.nonLiveItems}`)
 *
 * The data feeding both surfaces is the REAL `buildUpcomingItems(...)` output —
 * no hand-built arrays — so the dedup runs through production code end to end.
 *
 * INVARIANT PROVEN AT THE RENDER LEVEL:
 *   A currently-live offering RENDERS in the Live-now carousel and does NOT
 *   render anywhere in the Upcoming FlatList; a scheduled (future) offering
 *   renders in the Upcoming FlatList and NOT in the carousel. No leakage either
 *   direction.
 *
 * FAILS-ON-REVERT: the FlatList is fed `nonLiveItems ?? items` — the exact
 * fallback semantics of reverting the fix. Delete the
 * `nonLiveItems = nonPast.filter((i) => i.status !== "live")` line in
 * upcomingBuilder.ts (and `nonLiveItems` from the return) and `nonLiveItems`
 * becomes `undefined` -> the FlatList renders from `items` (which INCLUDES the
 * live offering) -> the live offering LEAKS into the rendered Upcoming list ->
 * `queryByText(LIVE_NAME)` inside the upcoming host is non-null -> this test
 * FAILS. Restore -> green. (Tester-verified; see TEST report §SC-7.)
 *
 * Different angle vs implementor: implementor asserts the array; THIS asserts
 * the actual DOM/host-tree the user sees — a live row is absent from the
 * Upcoming list host AND present in the carousel host, through the real
 * UpcomingListItem + LiveOfferingCard components.
 *
 * Run: npx jest --config jest.orch1143.render.cjs --runInBand
 */

import React from "react";
import { FlatList, View } from "react-native";
import { render, within } from "@testing-library/react-native";

// Lightweight stubs for purely-presentational deps so the mount is fast +
// deterministic. The component's OWN routing logic (kind branch, name render,
// live-vs-upcoming) runs for real.
jest.mock("../../ui/GlassCard", () => {
  const { View: V } = require("react-native");
  return { GlassCard: ({ children, testID }: any) => <V testID={testID}>{children}</V> };
});
jest.mock("../../ui/Pill", () => {
  const { Text: T } = require("react-native");
  return { Pill: ({ children }: any) => <T>{children}</T> };
});
jest.mock("../../ui/Icon", () => {
  const { View: V } = require("react-native");
  return { Icon: ({ name }: any) => <V testID={`icon-${name}`} /> };
});
jest.mock("../../ui/EventCoverMedia", () => {
  const { View: V } = require("react-native");
  return { EventCoverMedia: () => <V /> };
});
jest.mock("../HomeTripRow", () => {
  const { Text: T } = require("react-native");
  return { HomeTripRow: ({ trip }: any) => <T>{trip?.name ?? "trip"}</T> };
});
jest.mock("../../../utils/eventDateDisplay", () => ({
  formatDraftDateLine: () => "Today · 7:00 PM",
}));

import { LiveOfferingCard, type LiveCardMetrics } from "../LiveOfferingCard";
import { UpcomingListItem } from "../UpcomingListItem";
import { buildUpcomingItems } from "../../../utils/upcomingBuilder";
import type { LiveEvent } from "../../../store/liveEventStore";

// Fixed "now" — 2026-06-01 12:00 UTC. deriveLiveStatus reads Date.now(); pin it
// so the date fixtures below resolve live/upcoming deterministically.
const NOW = new Date("2026-06-01T12:00:00.000Z").getTime();

const LIVE_NAME = "LIVE_CONCERT_X";
const SCHEDULED_NAME = "SCHEDULED_GALA_Y";

// Minimal LiveEvent shape sufficient for buildUpcomingItems + both render
// components. status:"live" is the persisted publish state; the *derived*
// live/upcoming classification comes from the date vs NOW.
const ev = (patch: Partial<LiveEvent>): LiveEvent =>
  ({
    id: "evt",
    serverEventId: null,
    brandId: "brand-1",
    brandSlug: "brand-one",
    eventSlug: "evt-one",
    status: "live",
    publishedAt: "2026-05-01T09:00:00.000Z",
    cancelledAt: null,
    endedAt: null,
    name: "Event",
    description: "",
    format: "in_person",
    whenMode: "single",
    date: "2026-06-15",
    doorsOpen: "19:00",
    endsAt: "23:00",
    timezone: "UTC",
    recurrenceRule: null,
    multiDates: null,
    venueName: "Venue",
    address: "1 Main St",
    onlineUrl: null,
    hideAddressUntilTicket: true,
    coverHue: 25,
    coverMediaUrl: null,
    coverMediaType: null,
    tickets: [],
    visibility: "public",
    requireApproval: false,
    allowTransfers: true,
    hideRemainingCount: false,
    passwordProtected: false,
    privateGuestList: false,
    inPersonPaymentsEnabled: false,
    currency: "USD",
    ...patch,
  }) as LiveEvent;

const metrics: LiveCardMetrics = {
  revenueLabel: "$120",
  soldValue: "6",
  capacityLabel: "20",
  capacity: 20,
  progress: 0.3,
};

const noopHandlers = {
  onOpenDraft: jest.fn(),
  onOpenTrip: jest.fn(),
  onOpenLiveEvent: jest.fn(),
};

/**
 * Faithful render of home.tsx's two offering surfaces from REAL builder output.
 * The FlatList data binding uses `nonLiveItems ?? items` to reproduce both the
 * fixed state (nonLiveItems present -> live excluded) AND the reverted state
 * (nonLiveItems undefined -> falls back to items -> live LEAKS).
 */
function HomeOfferingSlice(): React.ReactElement {
  const live = ev({
    id: "evt-live",
    name: LIVE_NAME,
    status: "live",
    date: "2026-06-01",
    doorsOpen: "08:00",
    endsAt: "23:00",
  });
  const scheduled = ev({
    id: "evt-soon",
    name: SCHEDULED_NAME,
    status: "live",
    date: "2026-06-20",
    doorsOpen: "19:00",
    endsAt: "23:00",
  });

  const built = buildUpcomingItems([live, scheduled], [], [], [], NOW);
  // Mirror home.tsx: live carousel reads liveItems; Upcoming list reads
  // nonLiveItems. The `?? items` is the revert-equivalent fallback.
  const liveItems = built.liveItems;
  const upcomingData =
    (built as { nonLiveItems?: typeof built.items }).nonLiveItems ?? built.items;

  return (
    <View>
      <View testID="live-carousel-host">
        {liveItems.map((liveItem) => (
          <LiveOfferingCard
            key={liveItem.key}
            item={liveItem}
            metrics={metrics}
            onScanPress={jest.fn()}
          />
        ))}
      </View>
      <View testID="upcoming-list-host">
        <FlatList
          data={upcomingData}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) => (
            <UpcomingListItem
              item={item}
              currentBrandCurrency="USD"
              eventSalesSummaries={{}}
              onOpenDraft={noopHandlers.onOpenDraft}
              onOpenTrip={noopHandlers.onOpenTrip}
              onOpenLiveEvent={noopHandlers.onOpenLiveEvent}
            />
          )}
        />
      </View>
    </View>
  );
}

describe("ORCH-1143 SC-7 RENDER — live offering excluded from the Upcoming list, present in the carousel", () => {
  // deriveLiveStatus reads the REAL Date.now(); pin it so the date fixtures
  // resolve live/upcoming deterministically (mirrors the SC-7 source block).
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(NOW);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a live event RENDERS in the Live-now carousel and does NOT render in the Upcoming FlatList", () => {
    const { getByTestId } = render(<HomeOfferingSlice />);

    const carousel = within(getByTestId("live-carousel-host"));
    const upcoming = within(getByTestId("upcoming-list-host"));

    // The live offering is surfaced in the carousel...
    expect(carousel.queryByText(LIVE_NAME)).toBeTruthy();
    // ...and is NOT duplicated into the Upcoming list (the SC-7 invariant; fails
    // on revert because the FlatList then falls back to `items`, which includes
    // the live row).
    expect(upcoming.queryByText(LIVE_NAME)).toBeNull();
  });

  test("a scheduled (future) event RENDERS in the Upcoming FlatList and NOT in the carousel — no leakage either direction", () => {
    const { getByTestId } = render(<HomeOfferingSlice />);

    const carousel = within(getByTestId("live-carousel-host"));
    const upcoming = within(getByTestId("upcoming-list-host"));

    // The scheduled offering stays in the Upcoming list...
    expect(upcoming.queryByText(SCHEDULED_NAME)).toBeTruthy();
    // ...and never leaks into the live carousel.
    expect(carousel.queryByText(SCHEDULED_NAME)).toBeNull();
  });
});
