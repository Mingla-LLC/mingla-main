/**
 * ORCH-1172 R3 — edit-RSVP must NOT clobber untouched settings.
 *
 * Device-proven bug: editing ONE published-RSVP setting (hide-address) and
 * saving silently reverted OTHER settings the host never touched —
 * `rsvp_discoverable` true→false and `hideRemainingCount` false→true. Root
 * cause was the full-state save (`buildRsvpUpdatePayload(editState)`) emitting
 * EVERY key always, so the RPC's COALESCE-to-existing-on-absent safety never
 * fired and a wrong (default-hydrated) editState value overwrote the DB.
 *
 * This locks the DIFF-based save (`buildRsvpUpdatePayloadDiff`): it ALWAYS emits
 * the RPC-required `title` + `when` + `requestedVisibility`, but emits each of
 * the 9 host-control toggles ONLY when it differs from the loaded LiveEvent.
 * Omitted toggles → the RPC keeps the stored value → no clobber.
 *
 * Fails-on-revert: swap `buildRsvpUpdatePayloadDiff` back to the full-state
 * `buildRsvpUpdatePayload` (or have the diff emit unchanged keys) → the
 * "OMITS unchanged toggles" assertions throw (the clobber vector returns).
 */

import { describe, expect, test } from "@jest/globals";

import { liveEventToEditableDraft } from "../liveEventAdapter";
import { buildRsvpUpdatePayloadDiff } from "../serverDraftEventMapper";
import type { DraftEvent } from "../../store/draftEventStore";
import type { LiveEvent } from "../../store/liveEventStore";

// A correctly-hydrated published RSVP (post-B1): discoverable ON, hide-remaining
// OFF, hide-address OFF, capacity 30, manual approval, plus-ones on — i.e. the
// real DB values the host saved. The device repro changes ONLY hide-address.
const rsvpLiveEvent = (patch: Partial<LiveEvent> = {}): LiveEvent =>
  ({
    id: "rsvp-1",
    serverEventId: "server-rsvp-1",
    brandId: "brand-1",
    brandSlug: "brand",
    eventSlug: "house-party",
    status: "scheduled",
    publishedAt: "2026-06-01T12:00:00.000Z",
    cancelledAt: null,
    endedAt: null,
    event_type: "rsvp",
    name: "House Party",
    description: "BYOB.",
    format: "in_person",
    category: null,
    whenMode: "single",
    date: "2026-07-01",
    doorsOpen: "19:00",
    endsAt: "23:00",
    timezone: "America/New_York",
    recurrenceRule: null,
    multiDates: null,
    venueName: "Loft 5",
    address: "5 Main St",
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
    currency: "USD",
    tickets: [],
    visibility: "public",
    requireApproval: false,
    allowTransfers: true,
    hideRemainingCount: false,
    passwordProtected: false,
    privateGuestList: false,
    inPersonPaymentsEnabled: false,
    orders: [],
    // The REAL saved host-control snapshot (post-B1 hydration).
    rsvpCapacity: 30,
    rsvpAllowPlusOnes: true,
    rsvpPlusOnesMax: 2,
    rsvpWaitlistEnabled: true,
    rsvpApprovalMode: "manual",
    rsvpDiscoverable: true,
    rsvpGoingCount: 4,
    createdAt: "2026-06-01T11:00:00.000Z",
    updatedAt: "2026-06-01T12:00:00.000Z",
    ...patch,
  }) as LiveEvent;

describe("ORCH-1172 R3 — edit-RSVP no-clobber diff payload", () => {
  test("editing ONLY hide-address OMITS every untouched toggle (the device repro)", () => {
    const original = rsvpLiveEvent();
    // The exact device repro: flip hide-address, touch nothing else.
    const edited: DraftEvent = {
      ...liveEventToEditableDraft(original),
      hideAddressUntilTicket: true,
    };

    const payload = buildRsvpUpdatePayloadDiff(original, edited);

    // The ONE changed toggle is present + correct.
    expect(payload.hideAddressUntilTicket).toBe(true);

    // The CLOBBER VECTORS: discoverable + hideRemainingCount must NOT be in the
    // payload, so the RPC COALESCEs them to their existing stored values
    // (discoverable=true, hideRemainingCount=false) instead of overwriting.
    expect(payload).not.toHaveProperty("rsvpDiscoverable");
    expect(payload).not.toHaveProperty("hideRemainingCount");

    // Every OTHER untouched host-control is also omitted.
    expect(payload).not.toHaveProperty("rsvpCapacity");
    expect(payload).not.toHaveProperty("rsvpAllowPlusOnes");
    expect(payload).not.toHaveProperty("rsvpPlusOnesMax");
    expect(payload).not.toHaveProperty("rsvpWaitlistEnabled");
    expect(payload).not.toHaveProperty("rsvpApprovalMode");
    expect(payload).not.toHaveProperty("privateGuestList");
  });

  test("always emits the RPC-required title + when + requestedVisibility", () => {
    const original = rsvpLiveEvent();
    const edited: DraftEvent = {
      ...liveEventToEditableDraft(original),
      hideAddressUntilTicket: true,
    };

    const payload = buildRsvpUpdatePayloadDiff(original, edited);

    // title is hard-required by biz_update_live_rsvp (rsvp_title_required).
    expect(payload.title).toBe("House Party");
    expect(payload.title.length).toBeGreaterThan(0);
    // when + requestedVisibility always present (idempotent; drives material
    // -change notify + visibility correctly).
    expect(payload.when).toEqual({
      date: "2026-07-01",
      doorsOpen: "19:00",
      endsAt: "23:00",
    });
    expect(payload.requestedVisibility).toBe("public");
  });

  test("a changed toggle IS emitted; an unchanged sibling is NOT", () => {
    const original = rsvpLiveEvent();
    const edited: DraftEvent = {
      ...liveEventToEditableDraft(original),
      rsvpCapacity: 99, // changed
      // discoverable, approval, plus-ones … all unchanged
    };

    const payload = buildRsvpUpdatePayloadDiff(original, edited);

    expect(payload.rsvpCapacity).toBe(99);
    expect(payload).not.toHaveProperty("rsvpDiscoverable");
    expect(payload).not.toHaveProperty("rsvpApprovalMode");
    expect(payload).not.toHaveProperty("hideAddressUntilTicket");
  });

  test("an unedited RSVP yields a payload with NO toggles (pure no-op save)", () => {
    const original = rsvpLiveEvent();
    const payload = buildRsvpUpdatePayloadDiff(
      original,
      liveEventToEditableDraft(original),
    );

    for (const key of [
      "rsvpCapacity",
      "rsvpAllowPlusOnes",
      "rsvpPlusOnesMax",
      "rsvpWaitlistEnabled",
      "rsvpApprovalMode",
      "rsvpDiscoverable",
      "privateGuestList",
      "hideRemainingCount",
      "hideAddressUntilTicket",
    ]) {
      expect(payload).not.toHaveProperty(key);
    }
    // …but the always-on fields are still there (the RPC needs title).
    expect(payload.title).toBe("House Party");
  });

  test("explicitly turning a toggle OFF (true→false) IS emitted, not dropped", () => {
    // discoverable was ON in the DB; host turns it OFF. An ABSENT key would
    // COALESCE back to true, so the explicit false MUST be emitted.
    const original = rsvpLiveEvent({ rsvpDiscoverable: true });
    const edited: DraftEvent = {
      ...liveEventToEditableDraft(original),
      rsvpDiscoverable: false,
    };

    const payload = buildRsvpUpdatePayloadDiff(original, edited);

    expect(payload.rsvpDiscoverable).toBe(false);
  });
});
