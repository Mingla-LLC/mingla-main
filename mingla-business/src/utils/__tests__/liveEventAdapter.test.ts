import { describe, expect, test } from "@jest/globals";

import {
  classifySeverity,
  editableDraftToPatch,
  liveEventToEditableDraft,
} from "../liveEventAdapter";
import type { DraftEvent } from "../../store/draftEventStore";
import type { LiveEvent } from "../../store/liveEventStore";

const ticket = () => ({
  id: "ticket-1",
  name: "General",
  priceGbp: null,
  capacity: null,
  isFree: true,
  isUnlimited: true,
  visibility: "public" as const,
  displayOrder: 0,
  approvalRequired: false,
  passwordProtected: false,
  password: null,
  passwordConfigured: false,
  waitlistEnabled: false,
  minPurchaseQty: 1,
  maxPurchaseQty: null,
  allowTransfers: true,
  description: null,
  saleStartAt: null,
  saleEndAt: null,
  availableAt: "online" as const,
});

const liveEvent = (patch: Partial<LiveEvent> = {}): LiveEvent => ({
  id: "event-1",
  serverEventId: "server-event-1",
  brandId: "brand-1",
  brandSlug: "brand",
  eventSlug: "event",
  status: "scheduled",
  publishedAt: "2026-05-11T12:00:00.000Z",
  cancelledAt: null,
  endedAt: null,
  name: "Supper Club",
  description: "Dinner and music.",
  format: "in_person",
  category: "food",
  whenMode: "single",
  date: "2026-06-01",
  doorsOpen: "18:00",
  endsAt: "22:00",
  timezone: "Europe/London",
  recurrenceRule: null,
  multiDates: null,
  venueName: "Main Hall",
  address: "1 High Street",
  onlineUrl: null,
  hideAddressUntilTicket: true,
  coverHue: 25,
  coverMediaUrl: "https://media.giphy.com/old.gif",
  coverMediaType: "gif",
  coverMediaProvider: "giphy",
  coverMediaSourceUrl: "https://giphy.com/gifs/old",
  coverMediaCredit: "GIPHY",
  coverMediaCreditUrl: "https://giphy.com",
  coverMediaAlt: "Old cover",
  currency: "GBP",
  tickets: [ticket()],
  visibility: "public",
  requireApproval: false,
  allowTransfers: true,
  hideRemainingCount: false,
  passwordProtected: false,
  privateGuestList: false,
  inPersonPaymentsEnabled: false,
  orders: [],
  createdAt: "2026-05-11T11:00:00.000Z",
  updatedAt: "2026-05-11T12:00:00.000Z",
  ...patch,
});

describe("liveEventAdapter", () => {
  test("published cover edit patch carries selected provider metadata", () => {
    const original = liveEvent();
    const edited: DraftEvent = {
      ...liveEventToEditableDraft(original),
      coverMediaUrl: "https://images.pexels.com/photos/1/landscape.jpeg",
      coverMediaType: "image",
      coverMediaProvider: "pexels",
      coverMediaSourceUrl: "https://www.pexels.com/photo/1/",
      coverMediaCredit: "Jane Photographer",
      coverMediaCreditUrl: "https://www.pexels.com/@jane",
      coverMediaAlt: "Guests at a supper club",
    };

    const patch = editableDraftToPatch(original, edited);

    expect(patch).toMatchObject({
      coverMediaUrl: "https://images.pexels.com/photos/1/landscape.jpeg",
      coverMediaType: "image",
      coverMediaProvider: "pexels",
      coverMediaSourceUrl: "https://www.pexels.com/photo/1/",
      coverMediaCredit: "Jane Photographer",
      coverMediaCreditUrl: "https://www.pexels.com/@jane",
      coverMediaAlt: "Guests at a supper club",
    });
    expect(classifySeverity(Object.keys(patch) as never)).toBe("additive");
  });

  test("published cover edit patch clears stale provider metadata for upload covers", () => {
    const original = liveEvent();
    const edited: DraftEvent = {
      ...liveEventToEditableDraft(original),
      coverMediaUrl: "https://cdn.example.com/uploaded-cover.jpg",
      coverMediaType: "image",
      coverMediaProvider: "upload",
      coverMediaSourceUrl: null,
      coverMediaCredit: null,
      coverMediaCreditUrl: null,
      coverMediaAlt: null,
    };

    expect(editableDraftToPatch(original, edited)).toMatchObject({
      coverMediaUrl: "https://cdn.example.com/uploaded-cover.jpg",
      coverMediaType: "image",
      coverMediaProvider: "upload",
      coverMediaSourceUrl: null,
      coverMediaCredit: null,
      coverMediaCreditUrl: null,
      coverMediaAlt: null,
    });
  });
});
