/**
 * ORCH-1172 — edit-RSVP parity regression suite.
 *
 * Proves the two blocking bugs the spec found are fixed:
 *   BUG-A: the edit save passed a raw camelCase patch with NO `title`, so
 *          biz_update_live_rsvp raised rsvp_title_required on EVERY save.
 *   BUG-B: the 6 rsvp* host-controls were never diffed into the patch, so
 *          capacity/approval/discoverable/etc. changes were silently dropped.
 *
 * It also locks the section-list parity: rsvpMode → RSVP section list (RsvpStep5
 * `rsvp-setup` after Cover, NO `tickets`, NO generic `settings`); ticketed mode →
 * the byte-identical SECTIONS (regression lock for D1-#8).
 *
 * Fails-on-revert: revert the editableDraftToPatch rsvp* diff branches → the
 * "edited controls reach the patch" assertions throw (BUG-B regression). Revert
 * buildRsvpUpdatePayload's `title` → the "payload carries a non-empty title"
 * assertion throws (BUG-A regression). Revert the privateGuestList /
 * hideRemainingCount lines in buildRsvpUpdatePayload (the BUG-C theme-settings
 * persistence gap, migration 20261113000000) → the "payload carries the two
 * privacy toggles" assertion throws. Revert the hideAddressUntilTicket line
 * (the R2 theme.business_event.hideAddressUntilTicket persistence gap, migration
 * 20261114000000) → the two "carries hideAddressUntilTicket" assertions throw.
 */

import { describe, expect, test } from "@jest/globals";

import {
  computeRichFieldDiffs,
  editableDraftToPatch,
  liveEventToEditableDraft,
  MATERIAL_KEYS,
} from "../liveEventAdapter";
import { buildRsvpUpdatePayload } from "../serverDraftEventMapper";
import { sectionsForMode } from "../../components/event/editPublishedSections";
import type { DraftEvent } from "../../store/draftEventStore";
import type { LiveEvent } from "../../store/liveEventStore";

// A published RSVP LiveEvent (event_type='rsvp') as the route hydrates it from
// the server: capacity 20 / plus-ones off / auto approval / discoverable off.
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
    // RSVP host-control snapshot (the route attaches these from the probe).
    rsvpCapacity: 20,
    rsvpAllowPlusOnes: false,
    rsvpPlusOnesMax: 0,
    rsvpWaitlistEnabled: false,
    rsvpApprovalMode: "auto",
    rsvpDiscoverable: false,
    rsvpGoingCount: 4,
    createdAt: "2026-06-01T11:00:00.000Z",
    updatedAt: "2026-06-01T12:00:00.000Z",
    ...patch,
  }) as LiveEvent;

describe("ORCH-1172 — edit-RSVP parity", () => {
  // ----- Section-list parity (D1-#1 + D1-#8 regression lock) ----------------

  test("rsvpMode section list mounts the RSVP setup card and drops tickets+settings", () => {
    const keys = sectionsForMode(true).map((s) => s.key);
    expect(keys).toEqual(["basics", "when", "where", "cover", "visual", "rsvp-setup"]);
    // RSVP setup mirrors create order (after Cover; the edit-only Visual/theme
    // card — which the create wizard has no equivalent of — sits between them).
    expect(keys.indexOf("rsvp-setup")).toBeGreaterThan(keys.indexOf("cover"));
    expect(keys[keys.length - 1]).toBe("rsvp-setup");
    // Ticketed-only sections are gone in RSVP mode.
    expect(keys).not.toContain("tickets");
    expect(keys).not.toContain("settings");
    // stepIndex null → the ticketed validateStep never runs against an RSVP draft.
    const rsvpSetup = sectionsForMode(true).find((s) => s.key === "rsvp-setup");
    expect(rsvpSetup?.stepIndex).toBeNull();
  });

  test("ticketed mode section list is byte-identical (no rsvp-setup, keeps tickets+settings)", () => {
    const keys = sectionsForMode(false).map((s) => s.key);
    expect(keys).toEqual([
      "basics",
      "when",
      "where",
      "cover",
      "visual",
      "tickets",
      "settings",
    ]);
    expect(keys).not.toContain("rsvp-setup");
  });

  // ----- BUG-B: rsvp* controls now diff into the patch ----------------------

  test("editing capacity + approval mode + discoverable produces a patch carrying all three (BUG-B fixed)", () => {
    const original = rsvpLiveEvent();
    const edited: DraftEvent = {
      ...liveEventToEditableDraft(original),
      rsvpCapacity: 50,
      rsvpApprovalMode: "manual",
      rsvpDiscoverable: true,
    };

    const patch = editableDraftToPatch(original, edited);

    expect(patch.rsvpCapacity).toBe(50);
    expect(patch.rsvpApprovalMode).toBe("manual");
    expect(patch.rsvpDiscoverable).toBe(true);
    // Unchanged controls must NOT appear in the patch.
    expect(patch).not.toHaveProperty("rsvpAllowPlusOnes");
    expect(patch).not.toHaveProperty("rsvpPlusOnesMax");
    expect(patch).not.toHaveProperty("rsvpWaitlistEnabled");
  });

  test("each rsvp control diffs independently; an unchanged RSVP yields an empty patch", () => {
    const original = rsvpLiveEvent();
    const noChange = editableDraftToPatch(original, liveEventToEditableDraft(original));
    expect(Object.keys(noChange)).toHaveLength(0);

    const plusOnesOn: DraftEvent = {
      ...liveEventToEditableDraft(original),
      rsvpAllowPlusOnes: true,
      rsvpPlusOnesMax: 3,
    };
    const patch = editableDraftToPatch(original, plusOnesOn);
    expect(patch.rsvpAllowPlusOnes).toBe(true);
    expect(patch.rsvpPlusOnesMax).toBe(3);
  });

  test("rsvp host-controls are SAFE (none are MATERIAL — no buyer SMS for moneyless RSVP)", () => {
    const rsvpKeys = [
      "rsvpCapacity",
      "rsvpAllowPlusOnes",
      "rsvpPlusOnesMax",
      "rsvpWaitlistEnabled",
      "rsvpApprovalMode",
      "rsvpDiscoverable",
    ] as const;
    for (const k of rsvpKeys) {
      expect(MATERIAL_KEYS).not.toContain(k);
    }
  });

  // ----- rsvp* changes surface in the ChangeSummaryModal (labeled diffs) -----

  test("computeRichFieldDiffs labels the rsvp changes (drives the RSVP 'Edited' indicator)", () => {
    const original = rsvpLiveEvent();
    const edited: DraftEvent = {
      ...liveEventToEditableDraft(original),
      rsvpCapacity: 50,
      rsvpApprovalMode: "manual",
    };
    const diffs = computeRichFieldDiffs(original, edited);
    const byKey = new Map(diffs.map((d) => [d.fieldKey, d]));
    expect(byKey.get("rsvpCapacity")?.fieldLabel).toBe("Guest limit");
    expect(byKey.get("rsvpApprovalMode")?.fieldLabel).toBe("Approval mode");
    // RSVP fields are safe severity (additive), never material.
    expect(byKey.get("rsvpCapacity")?.severity).toBe("safe");
  });

  // ----- BUG-A: payload always carries a title + the RPC-shape keys ----------

  test("buildRsvpUpdatePayload always carries a non-empty title + when block (BUG-A fixed)", () => {
    const original = rsvpLiveEvent();
    // Edit only the capacity — the name is unchanged. The OLD code sent the
    // sparse patch (no `name`/`title`) → rsvp_title_required. The fix reads the
    // full editState so `title` is always present.
    const edited: DraftEvent = {
      ...liveEventToEditableDraft(original),
      rsvpCapacity: 99,
    };

    const payload = buildRsvpUpdatePayload(edited);

    expect(payload.title).toBe("House Party");
    expect(payload.title.length).toBeGreaterThan(0);
    expect(payload.when).toEqual({
      date: "2026-07-01",
      doorsOpen: "19:00",
      endsAt: "23:00",
    });
  });

  test("buildRsvpUpdatePayload maps visibility→requestedVisibility + carries all 6 rsvp* keys in RPC shape", () => {
    const original = rsvpLiveEvent();
    const edited: DraftEvent = {
      ...liveEventToEditableDraft(original),
      visibility: "private",
      rsvpCapacity: 12,
      rsvpAllowPlusOnes: true,
      rsvpPlusOnesMax: 2,
      rsvpWaitlistEnabled: true,
      rsvpApprovalMode: "manual",
      rsvpDiscoverable: false,
    };

    const payload = buildRsvpUpdatePayload(edited);

    // visibility → requestedVisibility (the RPC reads requestedVisibility).
    expect(payload.requestedVisibility).toBe("private");
    // All 6 host-controls present in the camelCase shape the RPC reads.
    expect(payload).toMatchObject({
      rsvpCapacity: 12,
      rsvpAllowPlusOnes: true,
      rsvpPlusOnesMax: 2,
      rsvpWaitlistEnabled: true,
      rsvpApprovalMode: "manual",
      rsvpDiscoverable: false,
    });
    // snake_case location/cover keys the RPC expects.
    expect(payload).toHaveProperty("location_text");
    expect(payload).toHaveProperty("cover_media_url");
    expect(payload).toHaveProperty("cover_media_type");
    expect(payload.location_text).toBe("Loft 5 · 5 Main St");
  });

  // ----- BUG-C: privacy toggles reach the RPC so it can persist them into
  //             theme.business_event.settings (migration 20261113000000) -------

  test("buildRsvpUpdatePayload carries privateGuestList + hideRemainingCount (BUG-C fixed)", () => {
    const original = rsvpLiveEvent();
    const edited: DraftEvent = {
      ...liveEventToEditableDraft(original),
      privateGuestList: true,
      hideRemainingCount: true,
    };

    const payload = buildRsvpUpdatePayload(edited);

    // These are NOT DB columns — biz_update_live_rsvp deep-merges them into
    // theme.business_event.settings. The RPC can only persist what the client
    // sends, so the payload MUST carry them or the toggle save silently no-ops.
    expect(payload.privateGuestList).toBe(true);
    expect(payload.hideRemainingCount).toBe(true);
  });

  test("buildRsvpUpdatePayload mirrors the unedited privacy toggles (default OFF round-trips)", () => {
    const payload = buildRsvpUpdatePayload(
      liveEventToEditableDraft(rsvpLiveEvent()),
    );
    expect(payload.privateGuestList).toBe(false);
    expect(payload.hideRemainingCount).toBe(false);
  });

  // ----- ORCH-1172 R2 — hideAddressUntilTicket reaches the RPC so it can
  //        persist into theme.business_event.hideAddressUntilTicket
  //        (migration 20261114000000) -------------------------------------
  //
  // Fails-on-revert: remove the `hideAddressUntilTicket: draft.hideAddressUntilTicket`
  // line from buildRsvpUpdatePayload → both assertions below throw. Without it
  // the edit save (publish with address shown → edit to "hide address until
  // RSVP'd going" → save) silently drops the flag and the address keeps showing
  // on every public surface (Seth, live).

  test("buildRsvpUpdatePayload carries hideAddressUntilTicket = true when toggled on (R2 fix)", () => {
    const original = rsvpLiveEvent({ hideAddressUntilTicket: false });
    const edited: DraftEvent = {
      ...liveEventToEditableDraft(original),
      hideAddressUntilTicket: true,
    };

    const payload = buildRsvpUpdatePayload(edited);

    // NOT a DB column — biz_update_live_rsvp writes it at
    // theme.business_event.hideAddressUntilTicket (direct child, NOT under
    // settings). The RPC can only persist what the client sends.
    expect(payload.hideAddressUntilTicket).toBe(true);
  });

  test("buildRsvpUpdatePayload carries hideAddressUntilTicket = false when toggled off (R2 round-trip)", () => {
    const original = rsvpLiveEvent({ hideAddressUntilTicket: true });
    const edited: DraftEvent = {
      ...liveEventToEditableDraft(original),
      hideAddressUntilTicket: false,
    };

    const payload = buildRsvpUpdatePayload(edited);

    // The false case must round-trip too — the RPC defaults to the stored value
    // when the key is ABSENT, so an explicit false must be emitted to clear a
    // previously-hidden address.
    expect(payload.hideAddressUntilTicket).toBe(false);
  });
});
