import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

import type { DraftEvent } from "../../store/draftEventStore";
import type { LiveEvent } from "../../store/liveEventStore";
import { buildBrandEventSummary } from "../brandEventSummary";

const NOW = new Date("2026-05-08T12:00:00.000Z").getTime();

const ticket = {
  id: "ticket-general",
  name: "General",
  priceGbp: 20,
  capacity: 100,
  isFree: false,
  isUnlimited: false,
  visibility: "public",
  displayOrder: 0,
  approvalRequired: false,
  passwordProtected: false,
  password: null,
  waitlistEnabled: false,
  minPurchaseQty: 1,
  maxPurchaseQty: null,
  allowTransfers: true,
  description: null,
  saleStartAt: null,
  saleEndAt: null,
  availableAt: "both",
} satisfies DraftEvent["tickets"][number];

const draft = (patch: Partial<DraftEvent> = {}): DraftEvent => ({
  id: "draft-1",
  brandId: "brand-1",
  name: "Draft event",
  description: "Draft description",
  format: "in_person",
  category: null,
  whenMode: "single",
  date: "2026-05-20",
  doorsOpen: "19:00",
  endsAt: "23:00",
  timezone: "Europe/London",
  recurrenceRule: null,
  multiDates: null,
  venueName: "Venue",
  address: "1 Main Street",
  onlineUrl: null,
  hideAddressUntilTicket: true,
  coverHue: 25,
  tickets: [ticket],
  visibility: "public",
  requireApproval: false,
  allowTransfers: true,
  hideRemainingCount: false,
  passwordProtected: false,
  privateGuestList: false,
  inPersonPaymentsEnabled: false,
  lastStepReached: 2,
  status: "draft",
  createdAt: "2026-05-01T09:00:00.000Z",
  updatedAt: "2026-05-07T09:00:00.000Z",
  ...patch,
});

const liveEvent = (patch: Partial<LiveEvent> = {}): LiveEvent => ({
  id: "live-1",
  brandId: "brand-1",
  brandSlug: "brand-one",
  eventSlug: "live-one",
  status: "live",
  publishedAt: "2026-05-01T09:00:00.000Z",
  cancelledAt: null,
  endedAt: null,
  name: "Live event",
  description: "Live description",
  format: "in_person",
  category: null,
  whenMode: "single",
  date: "2026-05-08",
  doorsOpen: "19:00",
  endsAt: "23:00",
  timezone: "Europe/London",
  recurrenceRule: null,
  multiDates: null,
  venueName: "Venue",
  address: "1 Main Street",
  onlineUrl: null,
  hideAddressUntilTicket: true,
  coverHue: 25,
  tickets: [ticket],
  visibility: "public",
  requireApproval: false,
  allowTransfers: true,
  hideRemainingCount: false,
  passwordProtected: false,
  privateGuestList: false,
  inPersonPaymentsEnabled: false,
  orders: [],
  createdAt: "2026-05-01T09:00:00.000Z",
  updatedAt: "2026-05-07T09:00:00.000Z",
  ...patch,
});

describe("buildBrandEventSummary", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("draft-only summaries keep drafts active and order by updated time", () => {
    const summary = buildBrandEventSummary([], [
      draft({ id: "older", updatedAt: "2026-05-01T09:00:00.000Z" }),
      draft({ id: "newer", updatedAt: "2026-05-07T09:00:00.000Z" }),
    ]);

    expect(summary.counts).toMatchObject({
      all: 2,
      active: 2,
      live: 0,
      upcoming: 0,
      draft: 2,
      past: 0,
    });
    expect(summary.activeItems.map((item) => item.key)).toEqual([
      "draft-newer",
      "draft-older",
    ]);
    expect(summary.primaryLiveItem).toBeNull();
  });

  test("upcoming live events are active and order by event date ascending", () => {
    const summary = buildBrandEventSummary(
      [
        liveEvent({ id: "later", date: "2026-06-10" }),
        liveEvent({ id: "sooner", date: "2026-05-20" }),
      ],
      [],
    );

    expect(summary.counts.upcoming).toBe(2);
    expect(summary.counts.active).toBe(2);
    expect(summary.activeItems.map((item) => item.key)).toEqual([
      "live-sooner",
      "live-later",
    ]);
  });

  test("live-window events become the primary live item", () => {
    const summary = buildBrandEventSummary(
      [liveEvent({ id: "tonight", date: "2026-05-08" })],
      [],
    );

    expect(summary.counts.live).toBe(1);
    expect(summary.primaryLiveItem?.key).toBe("live-tonight");
    expect(summary.activeItems[0]?.status).toBe("live");
  });

  test("past and cancelled live events stay out of active items", () => {
    const summary = buildBrandEventSummary(
      [
        liveEvent({ id: "past", date: "2026-04-01" }),
        liveEvent({
          id: "cancelled",
          date: "2026-05-20",
          status: "cancelled",
          cancelledAt: "2026-05-07T09:00:00.000Z",
        }),
      ],
      [],
    );

    expect(summary.counts.past).toBe(2);
    expect(summary.counts.active).toBe(0);
    expect(summary.activeItems).toEqual([]);
    expect(summary.allItems.map((item) => item.key)).toEqual([
      "live-cancelled",
      "live-past",
    ]);
  });

  test("mixed summaries order live, upcoming, then drafts", () => {
    const summary = buildBrandEventSummary(
      [
        liveEvent({ id: "upcoming", date: "2026-05-20" }),
        liveEvent({ id: "live-now", date: "2026-05-08" }),
      ],
      [draft({ id: "draft" })],
    );

    expect(summary.activeItems.map((item) => item.key)).toEqual([
      "live-live-now",
      "live-upcoming",
      "draft-draft",
    ]);
    expect(summary.counts).toMatchObject({
      all: 3,
      active: 3,
      live: 1,
      upcoming: 1,
      draft: 1,
      past: 0,
    });
  });
});
