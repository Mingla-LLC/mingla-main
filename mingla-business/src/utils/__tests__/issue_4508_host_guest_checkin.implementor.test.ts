/**
 * #4508 C7 / C8 (Host side): an unclaimed plus-one can be admitted by hand from
 * the guest sheet, shown as "Number ending NNNN" (never a full number), and the
 * host can switch "Guests can bring guests" on in RSVP setup.
 *
 * MINGLA-INVARIANT: I-4508-HOST-MANUAL-CHECKIN-LAST4-ONLY | issue #4508 | Host shows only the last four digits of a plus-one's number and checks them in by hand only while unclaimed and not yet in
 * FAILS-ON-REVERT: delete the cleanPhoneLast4 four-digit guard, the canCheckInByHand rule or the manualCheckInOutcome mapping and these fail.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canCheckInByHand,
  cleanPhoneLast4,
  manualCheckInFailureCopy,
  manualCheckInLabel,
  manualCheckInOutcome,
  markPlusGuestCheckedIn,
  normalisePlusGuests,
  phoneLast4Line,
} from "../rsvpGuestDisplay.ts";

Deno.test("phoneLast4Line shows four digits only, never a full number", () => {
  assertEquals(phoneLast4Line("0199"), "Number ending 0199");
  assertEquals(phoneLast4Line(" 0199 "), "Number ending 0199");
  assertEquals(phoneLast4Line(null), null);
  assertEquals(phoneLast4Line(undefined), null);
  assertEquals(phoneLast4Line(""), null);
  assertEquals(phoneLast4Line("null"), null);
  // A full number that leaked into the field is dropped, not rendered.
  assertEquals(phoneLast4Line("+2348012340199"), null);
  assertEquals(phoneLast4Line("08012340199"), null);
  assertEquals(phoneLast4Line("019"), null);
  assertEquals(phoneLast4Line("01a9"), null);
  assertEquals(cleanPhoneLast4(1234), null);
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
  for (const result of ["not_eligible", "revoked", "not_yet_open", "event_ended"]) {
    const o = manualCheckInOutcome({ result });
    assertEquals(o.kind, "refused");
    assert(o.message.length > 10);
  }
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
  assert(sheet.includes("phoneLast4Line(pg.phoneLast4)"));
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
