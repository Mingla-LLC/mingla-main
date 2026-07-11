/**
 * ORCH-1339 [momentum-card-cross-entity] — trip-side guest-privacy regression
 * (implementor-owned; SPEC §7 T-8-source / T-12-source, §9 business-side
 * safeguard). SOURCE-STRUCTURAL under the default node/ts-jest config (RTL
 * render harnesses exist only under dedicated per-ORCH configs — see
 * jest.config.cjs; the runtime/sim half of T-8 is the tester's).
 *
 * Pins: (1) the trip wizard Step-5 "Guest privacy" card + §4.8 byte-exact
 * copy; (2) wizard persistence via the setEventGuestPrivacy LEAF-WRITE RPC on
 * autosave AND publish; (3) the published-trip Settings accordion's two
 * controlled Switch rows; (4) the edit screen's SIDE-CHANNEL save (toggles
 * excluded from buildLiveTripPatch → never trip the refund gate / reason
 * prompt — SC-7); (5) hydration (Trip.guestPrivacy → seeds; tripToLiveEvent no
 * longer hard-codes false); (6) the service wrapper calls the new RPC.
 *
 * FAILS-ON-REVERT: deleting the Step-5 guest-privacy card, the
 * setEventGuestPrivacy calls, the side-channel diff, or re-hard-coding the
 * tripToLiveEvent literals makes a named assertion FAIL.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (rel: string): string =>
  readFileSync(path.resolve(__dirname, rel), "utf8");

const step5 = read("../TripCreatorStep5Policy.tsx");
const wizard = read("../TripCreatorWizard.tsx");
const editScreen = read("../EditPublishedTripScreen.tsx");
const accordion = read("../EditPublishedTripSettingsAccordion.tsx");
const tripToLive = read("../../../utils/tripToLiveEvent.ts");
const tripsService = read("../../../services/tripsService.ts");
const businessEvents = read("../../../services/businessEvents.ts");
const step6Settings = read("../../event/CreatorStep6Settings.tsx");
const rsvpStep5 = read("../../rsvp/RsvpStep5Setup.tsx");

describe("ORCH-1339 — trip wizard Step 5 (create)", () => {
  test("Step5Draft carries the two gates and the Guest-privacy card renders both rows", () => {
    expect(step5).toContain("privateGuestList: boolean");
    expect(step5).toContain("hideRemainingCount: boolean");
    expect(step5).toContain('testID="trip-step5-private-guestlist"');
    expect(step5).toContain('testID="trip-step5-hide-count"');
    expect(step5).toContain(">Guest privacy</Text>");
  });

  test("SPEC §4.8 byte-exact copy — trip Step 5 rows", () => {
    expect(step5).toContain('label="Private guest list"');
    expect(step5).toContain(
      'sub="Hide who\'s going. Travelers still see the going count."',
    );
    expect(step5).toContain('label="Hide remaining count"');
    expect(step5).toContain(
      "sub={'Don\\'t show \"X spots left\" or how full it is.'}",
    );
  });

  test("wizard seeds Step 5 from Trip.guestPrivacy and treats toggle edits as dirty (pristine check)", () => {
    expect(wizard).toContain(
      "privateGuestList: trip.guestPrivacy?.privateGuestList ?? false",
    );
    expect(wizard).toContain(
      "hideRemainingCount: trip.guestPrivacy?.hideRemainingCount ?? false",
    );
    expect(wizard).toContain(
      "step5Draft.privateGuestList !== initStep5.privateGuestList",
    );
    expect(wizard).toContain(
      "step5Draft.hideRemainingCount !== initStep5.hideRemainingCount",
    );
  });

  test("wizard persists via the setEventGuestPrivacy LEAF-WRITE RPC on Step-5 autosave AND publish (never the big trip RPCs)", () => {
    expect(wizard).toContain(
      'import { setEventGuestPrivacy } from "../../services/businessEvents"',
    );
    const calls = wizard.match(/setEventGuestPrivacy\(trip\.id, \{/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2); // autosaveStep5 + handleConfirmPublish
    // NON-BLOCKING contract: failure → toast, wizard continues.
    expect(wizard).toContain(
      "Couldn't save guest privacy — check Settings after publishing.",
    );
  });
});

describe("ORCH-1339 — published-trip Settings accordion (edit)", () => {
  test("accordion gains the two controlled Switch-row prop pairs", () => {
    expect(accordion).toContain("privateGuestList: boolean;");
    expect(accordion).toContain("onPrivateGuestListChange: (next: boolean) => void;");
    expect(accordion).toContain("hideRemainingCount: boolean;");
    expect(accordion).toContain("onHideRemainingCountChange: (next: boolean) => void;");
    expect(accordion).toContain('testID="settings-private-guestlist-switch"');
    expect(accordion).toContain('testID="settings-hide-count-switch"');
  });

  test("SPEC §4.8 byte-exact copy — trip edit accordion rows", () => {
    expect(accordion).toContain("Hide who's going. Travelers still see the going count.");
    expect(accordion).toContain('Don\'t show "X spots left" or how full it is.');
  });

  test("edit screen: toggles are a SIDE-CHANNEL — excluded from buildLiveTripPatch (never patch keys)", () => {
    expect(editScreen).toContain("guestPrivacyChanged");
    // The two gates NEVER enter the gated RPC's patch object.
    expect(editScreen).not.toContain("patch.privateGuestList");
    expect(editScreen).not.toContain("patch.hideRemainingCount");
    expect(editScreen).not.toContain("patch.private_guest_list");
    expect(editScreen).not.toContain("patch.hide_remaining_count");
    // Only DIRTY keys travel (partial update contract).
    expect(editScreen).toContain(
      "state.privateGuestList !== origPrivacy.privateGuestList",
    );
    expect(editScreen).toContain(
      "state.hideRemainingCount !== origPrivacy.hideRemainingCount",
    );
  });

  test("edit screen: toggle-ONLY save bypasses the reason prompt + refund gate (SC-7) and persists via the leaf RPC", () => {
    expect(editScreen).toContain(
      'import { setEventGuestPrivacy } from "../../services/businessEvents"',
    );
    const calls = editScreen.match(/setEventGuestPrivacy\(trip\.id,/g) ?? [];
    // handleSavePress direct branch + the two handleConfirmSave sites.
    expect(calls.length).toBeGreaterThanOrEqual(3);
    // The direct branch exists INSIDE the empty-patch early return (before the
    // "No changes to save." fallback), i.e. no ChangeSummaryModal for it.
    const savePress = editScreen.slice(
      editScreen.indexOf("const handleSavePress"),
      editScreen.indexOf("const handleConfirmSave"),
    );
    expect(savePress).toContain("guestPrivacyChanged");
    expect(savePress).toContain("setEventGuestPrivacy");
    expect(savePress).toContain("No changes to save.");
  });

  test("edit screen seeds + accordion wiring from Trip.guestPrivacy", () => {
    expect(editScreen).toContain(
      "privateGuestList: trip.guestPrivacy?.privateGuestList ?? false",
    );
    expect(editScreen).toContain(
      "hideRemainingCount: trip.guestPrivacy?.hideRemainingCount ?? false",
    );
    expect(editScreen).toContain("privateGuestList={editState.privateGuestList}");
    expect(editScreen).toContain("hideRemainingCount={editState.hideRemainingCount}");
  });
});

describe("ORCH-1339 — hydration + service", () => {
  test("tripsService maps guestPrivacy from theme.business_event.settings (false defaults)", () => {
    expect(tripsService).toContain("guestPrivacy?: {");
    expect(tripsService).toContain("function readGuestPrivacy(");
    expect(tripsService).toContain("s.privateGuestList === true");
    expect(tripsService).toContain("s.hideRemainingCount === true");
    expect(tripsService).toContain("guestPrivacy: readGuestPrivacy(event.theme)");
  });

  test("tripToLiveEvent no longer hard-codes the two flags to false", () => {
    expect(tripToLive).toContain(
      "hideRemainingCount: trip.guestPrivacy?.hideRemainingCount ?? false",
    );
    expect(tripToLive).toContain(
      "privateGuestList: trip.guestPrivacy?.privateGuestList ?? false",
    );
    expect(tripToLive).not.toContain("hideRemainingCount: false");
    expect(tripToLive).not.toContain("privateGuestList: false");
  });

  test("setEventGuestPrivacy calls the biz_set_event_guest_privacy leaf RPC with NULL-preserving params and returns the echo", () => {
    expect(businessEvents).toContain('supabase.rpc("biz_set_event_guest_privacy"');
    expect(businessEvents).toContain("p_private_guest_list: patch.privateGuestList ?? null");
    expect(businessEvents).toContain(
      "p_hide_remaining_count: patch.hideRemainingCount ?? null",
    );
    expect(businessEvents).toContain("set_event_guest_privacy_empty_response");
    // Never through the big edit RPCs from this wrapper.
    expect(businessEvents).not.toContain("biz_update_live_trip");
    expect(businessEvents).not.toContain("biz_update_live_experience");
  });
});

describe("ORCH-1339 — §4.8 copy on the standard-event + RSVP wizard homes (T-12)", () => {
  test("CreatorStep6Settings sub-copy is D2-honest (byte-exact)", () => {
    expect(step6Settings).toContain(
      'sub="Hide who\'s going. Guests still see the going count."',
    );
    expect(step6Settings).toContain(
      "sub={'Don\\'t show \"X left\" or how full it is.'}",
    );
    // The over-promising legacy strings are GONE.
    expect(step6Settings).not.toContain("Hide attendee count from buyers.");
    expect(step6Settings).not.toContain("Don't show 'X tickets left'.");
  });

  test("RsvpStep5Setup label + sub-copy corrected (byte-exact)", () => {
    expect(rsvpStep5).toContain('label="Keep the guest list private"');
    expect(rsvpStep5).toContain('sub="Hide who\'s going. Only you see the list."');
    expect(rsvpStep5).toContain('label="Hide the spots-left count"');
    expect(rsvpStep5).toContain(
      'sub="Guests see who\'s going — not how many spots remain."',
    );
    expect(rsvpStep5).not.toContain("Hide the Going count from guests");
    expect(rsvpStep5).not.toContain("Guests won't see how many are coming.");
  });
});
