// ORCH-1296 [chip-in-edit-published-gap] — frontend contract tests.
//
// Proves the EDIT-PUBLISHED RSVP chip-in triad on the pure functions this ORCH
// changed:
//   LOAD  — liveEventToEditableDraft projects the 3 chip-in fields off the loaded
//           LiveEvent into the editable DraftEvent view (so the toggle + amounts
//           hydrate to the TRUE stored state instead of always-off/blank).
//   DIFF  — editableDraftToPatch flags a chip-in change (fails-on-revert anchor:
//           without the ORCH-1296 diff block the patch is EMPTY → the screen shows
//           "No changes to save" and the edit is silently dropped).
//   SAVE  — buildRsvpUpdatePayloadDiff emits the 3 chip-in fields to the RPC ONLY
//           when they changed (so an unrelated edit never clobbers them).

import { describe, expect, test } from "@jest/globals";

import {
  editableDraftToPatch,
  liveEventToEditableDraft,
} from "../liveEventAdapter";
import { buildRsvpUpdatePayloadDiff } from "../serverDraftEventMapper";
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

// A published RSVP LiveEvent (event_type='rsvp'), chip-in OFF by default —
// mirrors what fetchBusinessEventById now hydrates for the edit-published screen.
const rsvpLiveEvent = (patch: Partial<LiveEvent> = {}): LiveEvent => ({
  id: "event-1",
  serverEventId: "server-event-1",
  brandId: "brand-1",
  brandSlug: "brand",
  eventSlug: "event",
  status: "scheduled",
  publishedAt: "2026-05-11T12:00:00.000Z",
  cancelledAt: null,
  endedAt: null,
  event_type: "rsvp",
  name: "House Party",
  description: "Bring the vibe.",
  format: "in_person",
  category: null,
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
  hideAddressUntilTicket: false,
  coverHue: 25,
  coverMediaUrl: null,
  coverMediaType: null,
  coverMediaProvider: null,
  coverMediaSourceUrl: null,
  coverMediaCredit: null,
  coverMediaCreditUrl: null,
  coverMediaAlt: null,
  currency: "GBP",
  tickets: [ticket()],
  visibility: "public",
  requireApproval: false,
  allowTransfers: true,
  hideRemainingCount: false,
  passwordProtected: false,
  privateGuestList: false,
  inPersonPaymentsEnabled: false,
  // ORCH-1150 host-controls.
  rsvpCapacity: null,
  rsvpAllowPlusOnes: false,
  rsvpPlusOnesMax: 0,
  rsvpWaitlistEnabled: false,
  rsvpApprovalMode: "auto",
  rsvpDiscoverable: false,
  rsvpGoingCount: 0,
  // ORCH-1291 chip-in config — OFF by default (the pre-edit state).
  rsvpContributionEnabled: false,
  rsvpContributionSuggestedCents: null,
  rsvpContributionMinCents: null,
  orders: [],
  createdAt: "2026-05-11T11:00:00.000Z",
  updatedAt: "2026-05-11T12:00:00.000Z",
  ...patch,
});

describe("ORCH-1296 edit-published RSVP chip-in", () => {
  test("LOAD: liveEventToEditableDraft hydrates the TRUE chip-in state", () => {
    const original = rsvpLiveEvent({
      rsvpContributionEnabled: true,
      rsvpContributionSuggestedCents: 200000,
      rsvpContributionMinCents: 100000,
    });

    const draft = liveEventToEditableDraft(original);

    expect(draft.rsvpContributionEnabled).toBe(true);
    expect(draft.rsvpContributionSuggestedCents).toBe(200000);
    expect(draft.rsvpContributionMinCents).toBe(100000);
  });

  test("DIFF: toggling chip-in on + typing amounts registers a real change", () => {
    const original = rsvpLiveEvent(); // chip-in OFF
    const edited: DraftEvent = {
      ...liveEventToEditableDraft(original),
      rsvpContributionEnabled: true,
      rsvpContributionSuggestedCents: 200000,
      rsvpContributionMinCents: 100000,
    };

    const patch = editableDraftToPatch(original, edited);

    // Fails-on-revert anchor: without the ORCH-1296 diff block this object is
    // EMPTY and the screen shows "No changes to save".
    expect(patch).toMatchObject({
      rsvpContributionEnabled: true,
      rsvpContributionSuggestedCents: 200000,
      rsvpContributionMinCents: 100000,
    });
    expect(Object.keys(patch).length).toBeGreaterThan(0);
  });

  test("DIFF: an unchanged chip-in config produces NO chip-in patch keys", () => {
    const original = rsvpLiveEvent({
      rsvpContributionEnabled: true,
      rsvpContributionSuggestedCents: 200000,
      rsvpContributionMinCents: 100000,
    });
    // Re-hydrate then change ONLY the name — chip-in untouched.
    const edited: DraftEvent = {
      ...liveEventToEditableDraft(original),
      name: "House Party (renamed)",
    };

    const patch = editableDraftToPatch(original, edited);

    expect(patch).not.toHaveProperty("rsvpContributionEnabled");
    expect(patch).not.toHaveProperty("rsvpContributionSuggestedCents");
    expect(patch).not.toHaveProperty("rsvpContributionMinCents");
    expect(patch.name).toBe("House Party (renamed)");
  });

  test("SAVE: buildRsvpUpdatePayloadDiff emits the 3 chip-in fields when changed", () => {
    const original = rsvpLiveEvent(); // chip-in OFF
    const edited: DraftEvent = {
      ...liveEventToEditableDraft(original),
      rsvpContributionEnabled: true,
      rsvpContributionSuggestedCents: 200000,
      rsvpContributionMinCents: 100000,
    };

    const payload = buildRsvpUpdatePayloadDiff(original, edited);

    expect(payload.rsvpContributionEnabled).toBe(true);
    expect(payload.rsvpContributionSuggestedCents).toBe(200000);
    expect(payload.rsvpContributionMinCents).toBe(100000);
  });

  test("SAVE: buildRsvpUpdatePayloadDiff OMITS chip-in fields when unchanged", () => {
    const original = rsvpLiveEvent({
      rsvpContributionEnabled: true,
      rsvpContributionSuggestedCents: 200000,
      rsvpContributionMinCents: 100000,
    });
    // Only the title changed — the RPC must COALESCE chip-in to the stored value.
    const edited: DraftEvent = {
      ...liveEventToEditableDraft(original),
      name: "House Party (renamed)",
    };

    const payload = buildRsvpUpdatePayloadDiff(original, edited);

    expect(payload).not.toHaveProperty("rsvpContributionEnabled");
    expect(payload).not.toHaveProperty("rsvpContributionSuggestedCents");
    expect(payload).not.toHaveProperty("rsvpContributionMinCents");
    expect(payload.title).toBe("House Party (renamed)");
  });
});
