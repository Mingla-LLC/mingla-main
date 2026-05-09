import { describe, expect, test } from "@jest/globals";

import type { LiveEvent } from "../../store/liveEventStore";
import type { TicketStub } from "../../store/draftEventStore";
import { validateLiveEventFieldUpdate } from "../publishedEventEditGuards";

const ticket = (patch: Partial<TicketStub> = {}): TicketStub => ({
  id: "ticket-1",
  name: "General",
  priceGbp: 20,
  capacity: 10,
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
  ...patch,
});

const liveEvent = (patch: Partial<LiveEvent> = {}): LiveEvent => ({
  id: "le_1",
  serverEventId: "event-1",
  brandId: "brand-1",
  brandSlug: "brand",
  eventSlug: "event",
  status: "live",
  publishedAt: "2026-06-01T10:00:00.000Z",
  cancelledAt: null,
  endedAt: null,
  name: "Live event",
  description: "A live event.",
  format: "in_person",
  category: null,
  whenMode: "single",
  date: "2026-06-10",
  doorsOpen: "18:00",
  endsAt: "22:00",
  timezone: "Europe/London",
  recurrenceRule: null,
  multiDates: null,
  venueName: "Studio",
  address: "1 Road",
  onlineUrl: null,
  hideAddressUntilTicket: true,
  coverHue: 25,
  coverMediaUrl: "https://cdn.example.com/old.jpg",
  coverMediaType: "image",
  tickets: [ticket()],
  visibility: "public",
  requireApproval: false,
  allowTransfers: true,
  hideRemainingCount: false,
  passwordProtected: false,
  privateGuestList: false,
  inPersonPaymentsEnabled: false,
  orders: [],
  createdAt: "2026-06-01T10:00:00.000Z",
  updatedAt: "2026-06-01T10:00:00.000Z",
  ...patch,
});

describe("published event edit guards", () => {
  test("rejects a media patch paired with an invalid sold-ticket edit before side effects", () => {
    const event = liveEvent();
    const result = validateLiveEventFieldUpdate(
      event,
      {
        coverMediaUrl: "https://cdn.example.com/new.gif",
        coverMediaType: "gif",
        tickets: [ticket({ capacity: 1 })],
      },
      { soldCountByTier: { "ticket-1": 2 }, soldCountForEvent: 2 },
      "Updating cover and ticket capacity",
    );

    expect(result).toEqual({
      ok: false,
      reason: "capacity_below_sold",
      tierIds: ["ticket-1"],
      affectedOrderCount: 2,
    });
  });

  test("accepts a cover-only patch when the edit reason is valid", () => {
    const result = validateLiveEventFieldUpdate(
      liveEvent(),
      {
        coverMediaUrl: "https://cdn.example.com/new.mp4",
        coverMediaType: "video",
      },
      { soldCountByTier: { "ticket-1": 2 }, soldCountForEvent: 2 },
      "Refreshing cover media",
    );

    expect(result).toEqual({ ok: true, trimmedReason: "Refreshing cover media" });
  });
});
