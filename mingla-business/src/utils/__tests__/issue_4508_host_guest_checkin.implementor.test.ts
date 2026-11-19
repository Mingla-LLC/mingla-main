// MINGLA-INVARIANT: I-4508-HOST-MANUAL-CHECKIN-LAST4-ONLY | issue #4508 | Host shows only the last four digits of a plus-one's number, names an unclaimed plus-one with the server's neutral name plus those digits, and checks them in by hand only while unclaimed and not yet in
/**
 * #4508 C7 / C8 / N-5 / N-9 (Host side): an unclaimed plus-one can be admitted
 * by hand from the guest sheet, is named "{Inviter}'s guest · NNNN" (never a
 * full number, never the account a number matched), a claimed guest is
 * refused by hand (their pass is scanned), and the host can switch "Guests can
 * bring guests" on in RSVP setup.
 *
 * FAILS-ON-REVERT: delete the cleanPhoneLast4 four-digit guard, the claimed branch of hostPlusGuestLabel, the canCheckInByHand rule or the manualCheckInOutcome mapping (claimed included) and these fail.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canCheckInByHand,
  cleanPhoneLast4,
  manualCheckInFailureCopy,
  manualCheckInLabel,
  manualCheckInOutcome,
  markPlusGuestCheckedIn,
  hostPlusGuestLabel,
  normalisePlusGuests,
  scanAttendeeName,
} from "../rsvpGuestDisplay.ts";

Deno.test("N-5: an unclaimed plus-one reads \"{Inviter}'s guest · NNNN\", never a full number", () => {
  assertEquals(hostPlusGuestLabel({ name: "Ada's guest", claimed: false, phoneLast4: "0199" }), "Ada's guest · 0199");
  assertEquals(hostPlusGuestLabel({ name: "Ada's guest", claimed: false, phoneLast4: " 0199 " }), "Ada's guest · 0199");
  // No usable digits: the name alone (a friend picked from a list, or a leak).
  assertEquals(hostPlusGuestLabel({ name: "Ada's guest", claimed: false, phoneLast4: null }), "Ada's guest");
  assertEquals(hostPlusGuestLabel({ name: "Ada's guest", claimed: false, phoneLast4: "+2348012340199" }), "Ada's guest");
  assertEquals(hostPlusGuestLabel({ name: "Ada's guest", claimed: false, phoneLast4: "08012340199" }), "Ada's guest");
  assertEquals(hostPlusGuestLabel({ name: "Ada's guest", claimed: false, phoneLast4: "019" }), "Ada's guest");
  assertEquals(hostPlusGuestLabel({ name: "Ada's guest", claimed: false, phoneLast4: "01a9" }), "Ada's guest");
  assertEquals(hostPlusGuestLabel({ name: "Ada's guest", claimed: false, phoneLast4: "null" }), "Ada's guest");
  assertEquals(cleanPhoneLast4(1234), null);
  // An empty server name still never renders blank.
  assertEquals(hostPlusGuestLabel({ name: null, claimed: false, phoneLast4: "0199" }, "Ada O."), "Ada's guest · 0199");
  // Claimed: the guest's own name, no digits.
  assertEquals(hostPlusGuestLabel({ name: "Kim Kerr", claimed: true, phoneLast4: "0199" }), "Kim Kerr");
});

Deno.test("N-5: the door scanner uses the same rule for a guest pass", () => {
  assertEquals(
    scanAttendeeName({ entityType: "guest", attendeeDisplayName: "Ada's guest", invitedByName: "Ada O.", claimed: false, phoneLast4: "0199" }),
    "Ada's guest · 0199",
  );
  assertEquals(
    scanAttendeeName({ entityType: "guest", attendeeDisplayName: "Kim Kerr", invitedByName: "Ada O.", claimed: true }),
    "Kim Kerr",
  );
  assertEquals(scanAttendeeName({ entityType: "primary", attendeeDisplayName: "Ada Obi", phoneLast4: "0199" }), "Ada Obi");
  // An older server sends no claimed / phoneLast4: the name as given.
  assertEquals(scanAttendeeName({ entityType: "guest", attendeeDisplayName: "Gus Grant" }), "Gus Grant");
});

Deno.test("normalisePlusGuests carries phoneLast4 and never a longer value", () => {
  const out = normalisePlusGuests([
    { id: "g1", phoneLast4: "0199", claimed: false },
    { id: "g2", phoneLast4: "+2348012340199" },
    { id: "g3" },
  ]);
  assertEquals(out[0].phoneLast4, "0199");
  assertEquals(out[1].phoneLast4, null);
  assertEquals(out[2].phoneLast4, null);
});

Deno.test("canCheckInByHand: only an unclaimed plus-one who is not in yet", () => {
  assert(canCheckInByHand({ claimed: false, checkedInAt: null }));
  assert(!canCheckInByHand({ claimed: true, checkedInAt: null }));
  assert(!canCheckInByHand({ claimed: false, checkedInAt: "2026-11-19T10:00:00Z" }));
  assert(!canCheckInByHand({ claimed: true, checkedInAt: "2026-11-19T10:00:00Z" }));
});

Deno.test("manualCheckInLabel uses the inviter's first name", () => {
  assertEquals(manualCheckInLabel("Ada O."), "Check in with Ada");
  assertEquals(manualCheckInLabel("Ada"), "Check in with Ada");
  assertEquals(manualCheckInLabel(null), "Check in");
  assertEquals(manualCheckInLabel("undefined"), "Check in");
});

Deno.test("manualCheckInOutcome: success and duplicate are checked in, the rest are refusals that say why", () => {
  const ok = manualCheckInOutcome({ result: "success", checkedInAt: "2026-11-19T10:00:00Z" });
  assertEquals(ok.kind, "checked_in");
  if (ok.kind === "checked_in") assertEquals(ok.checkedInAt, "2026-11-19T10:00:00Z");
  assertEquals(manualCheckInOutcome({ result: "duplicate" }).kind, "checked_in");
  for (const result of ["not_eligible", "revoked", "not_yet_open", "event_ended", "claimed"]) {
    const o = manualCheckInOutcome({ result });
    assertEquals(o.kind, "refused");
    assert(o.message.length > 10);
  }
  // N-9: a claimed guest is refused by hand and told to scan the pass.
  const claimed = manualCheckInOutcome({ result: "claimed" });
  assert(claimed.kind === "refused" && claimed.message.includes("Scan it at the door"));
  // Unknown, missing or empty answers are never shown as a success.
  assertEquals(manualCheckInOutcome({ result: "banana" }).kind, "refused");
  assertEquals(manualCheckInOutcome({}).kind, "refused");
  assertEquals(manualCheckInOutcome(null).kind, "refused");
  assertEquals(manualCheckInOutcome(undefined).kind, "refused");
});

Deno.test("manualCheckInFailureCopy names a permission failure and defers the rest", () => {
  assert(manualCheckInFailureCopy("scanner_not_authorized") !== null);
  assertEquals(manualCheckInFailureCopy("something else"), null);
  assertEquals(manualCheckInFailureCopy(undefined), null);
});

Deno.test("markPlusGuestCheckedIn flips only the named, not-yet-in guest", () => {
  const list = normalisePlusGuests([
    { id: "g1", name: "A" },
    { id: "g2", name: "B", checkedInAt: "2026-11-19T09:00:00Z" },
  ]);
  const out = markPlusGuestCheckedIn(list, "g1", "2026-11-19T10:00:00Z");
  assertEquals(out[0].checkedInAt, "2026-11-19T10:00:00Z");
  assertEquals(out[1].checkedInAt, "2026-11-19T09:00:00Z");
  // an already-in guest keeps the server's time
  const again = markPlusGuestCheckedIn(out, "g2", "2026-11-19T11:00:00Z");
  assertEquals(again[1].checkedInAt, "2026-11-19T09:00:00Z");
});

Deno.test("wiring: service, hook, sheet, console and setup step use the new pieces", () => {
  const scan = Deno.readTextFileSync("mingla-business/src/services/scanRsvpService.ts");
  assert(scan.includes('supabase.rpc("host_check_in_rsvp_guest"'));
  assert(scan.includes("p_guest_id: guestId"));
  const hook = Deno.readTextFileSync("mingla-business/src/hooks/useRsvpApprovals.ts");
  assert(hook.includes("useCheckInRsvpGuest"));
  assert(hook.includes('["rsvpCheckinSummary", eventId]'));
  assert(hook.includes("rsvpGuestKeys.list(eventId)"));
  const sheet = Deno.readTextFileSync("mingla-business/src/components/rsvp/RsvpGuestDetailSheet.tsx");
  assert(sheet.includes("canCheckInByHand(pg)"));
  assert(sheet.includes("hostPlusGuestLabel(pg, pg.invitedByName)"));
  const scanner = Deno.readTextFileSync("mingla-business/src/components/rsvp/RsvpAdmissionScanner.native.tsx");
  assert(scanner.includes("guestName: scanAttendeeName(result)"));
  assert(!scanner.includes("guestDisplayName(result.attendeeDisplayName"));
  assert(sheet.includes("manualCheckInLabel(pg.invitedByName)"));
  assert(!/guestPhone|\.phone\b/.test(sheet.split("PLUS-ONES")[1]?.split("CONTACT")[0] ?? ""));
  const console_ = Deno.readTextFileSync("mingla-business/src/components/rsvp/RsvpGuestConsole.tsx");
  assert(console_.includes("manualCheckInOutcome(res)"));
  assert(console_.includes("manualCheckInFailureCopy("));
  const step = Deno.readTextFileSync("mingla-business/src/components/rsvp/RsvpStep5Setup.tsx");
  assert(step.includes('"Guests can bring guests"'));
  assert(step.includes("Let a plus-one add their own guests once they claim their pass."));
  const drafts = Deno.readTextFileSync("mingla-business/src/services/eventDrafts.ts");
  assert(drafts.includes("rsvp_guests_can_bring\";"));
  assert(drafts.includes("rsvpGuestsCanBring: draft.rsvpGuestsCanBring === true"));
  const mapper = Deno.readTextFileSync("mingla-business/src/utils/serverDraftEventMapper.ts");
  assert(mapper.includes("payload.rsvpGuestsCanBring ="));
  assert(mapper.includes("row.rsvp_guests_can_bring"));
});

// ---- Fix round 4 ------------------------------------------------------------
// FAILS-ON-REVERT: take the ToastHost out of Sheet.web's centred card -> T4-A
// fails; drop plusGuestCheckedInLine (or its row Text) -> T4-B fails; append
// " phone number" to every label again -> P4 fails.
import { plusGuestCheckedInLine } from "../rsvpGuestDisplay.ts";
import { phoneFieldAccessibilityLabel } from "../../../../packages/phone-input/accessibilityLabel.ts";

Deno.test("T4-A: on desktop web the guest sheet has its own toast layer, above the card", () => {
  const web = Deno.readTextFileSync("mingla-business/src/components/ui/Sheet.web.tsx");
  const card = web.slice(web.indexOf("const DesktopCenteredCard"));
  const host = card.indexOf('<ToastHost layer="overlay" open={visible} />');
  assert(host > card.indexOf("{children}") && host < card.indexOf("</Modal>"),
    "the host sits inside the card's Modal, after the card, like SheetMobile and Modal");
  assert(/import \{ ToastHost \} from "\.\/ToastHost";/.test(web));
  // The guest sheet keeps routing its notices to its own in-sheet Toast.
  const sheet = Deno.readTextFileSync("mingla-business/src/components/rsvp/RsvpGuestDetailSheet.tsx");
  assert(sheet.includes('testID="rsvp-guest-detail-notice"') && sheet.includes("kind={noticeKind}"));
});

Deno.test("T4-B: a checked-in plus-one's row says \"Checked in\", now and after a refetch", () => {
  assertEquals(plusGuestCheckedInLine({ checkedInAt: "2026-11-19T20:00:00Z" }), "Checked in");
  assertEquals(plusGuestCheckedInLine({ checkedInAt: null }), null);
  assertEquals(plusGuestCheckedInLine({ checkedInAt: " null " }), null);
  // Immediately: the console marks the row checked in on success.
  const [marked] = markPlusGuestCheckedIn(
    normalisePlusGuests([{ id: "g1", name: "Ada's guest", claimed: false, checkedInAt: null }]),
    "g1",
    "2026-11-19T20:00:00Z",
  );
  assertEquals(plusGuestCheckedInLine(marked), "Checked in");
  // After a refetch: the server's checkedInAt reads the same way.
  const [fetched] = normalisePlusGuests([{ id: "g1", name: "Ada's guest", checkedInAt: "2026-11-19T20:00:00Z" }]);
  assertEquals(plusGuestCheckedInLine(fetched), "Checked in");
  assert(!canCheckInByHand(fetched), "and the button is gone");
  const sheet = Deno.readTextFileSync("mingla-business/src/components/rsvp/RsvpGuestDetailSheet.tsx");
  assert(sheet.includes("const checkedInLine = plusGuestCheckedInLine(pg);") &&
    sheet.includes("testID={`rsvp-plus-checked-in-${pg.id}`}"), "the row renders it");
});

Deno.test("P4: the guest number field's spoken name does not repeat itself", () => {
  assertEquals(phoneFieldAccessibilityLabel("By phone number"), "By phone number");
  assertEquals(phoneFieldAccessibilityLabel("Your"), "Your phone number");
  assertEquals(phoneFieldAccessibilityLabel(" Guest 1 "), "Guest 1 phone number");
  const web = Deno.readTextFileSync("mingla-business/src/components/event/useBusinessRsvpPhoneField.tsx");
  const app = Deno.readTextFileSync("app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx");
  assert(web.includes("phoneInputAccessibilityLabel={`${/phone number$/i.test(label) ? label : `${label} phone number`}"));
  assert(app.includes("phoneInputAccessibilityLabel={phoneFieldAccessibilityLabel(args.label)}"));
});
