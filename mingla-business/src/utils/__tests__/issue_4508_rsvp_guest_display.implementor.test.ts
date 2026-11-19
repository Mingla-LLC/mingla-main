/**
 * #4508 1.11 / 1.25 / 1.26 (Host side): plus-one guests never render an empty
 * name or "null", show "Invited by", a Claimed pill, and the door scanner names
 * the inviter.
 *
 * MINGLA-INVARIANT: I-4508-HOST-GUEST-DISPLAY-NULL-SAFE | issue #4508 | Host guest list and scanner render a guest name that is never empty, null or undefined, plus Invited by and Claimed status
 * FAILS-ON-REVERT: delete the guestDisplayName fallback or the scanDetailLine call and these fail.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  claimStatusLabel,
  emptyCell,
  guestDisplayName,
  invitedByLine,
  normalisePlusGuests,
  scanDetailLine,
} from "../rsvpGuestDisplay.ts";

Deno.test("guestDisplayName is never empty, null or undefined", () => {
  assertEquals(guestDisplayName("Sam Lee", "Ada O."), "Sam Lee");
  assertEquals(guestDisplayName("", "Ada O."), "Ada's guest");
  assertEquals(guestDisplayName(null, "Ada O."), "Ada's guest");
  assertEquals(guestDisplayName("null", null), "Guest");
  assertEquals(guestDisplayName(undefined, undefined), "Guest");
  assertEquals(guestDisplayName("   ", "  "), "Guest");
});

Deno.test("invited-by line, claim pill and empty cells", () => {
  assertEquals(invitedByLine("Ada O."), "Invited by Ada O.");
  assertEquals(invitedByLine(null), null);
  assertEquals(invitedByLine("undefined"), null);
  assertEquals(claimStatusLabel(true), "Claimed");
  assertEquals(claimStatusLabel(false), "Not claimed");
  assertEquals(claimStatusLabel(null), "Not claimed");
  assertEquals(emptyCell(null), "-");
  assertEquals(emptyCell("null"), "-");
  assertEquals(emptyCell("a@b.co"), "a@b.co");
});

Deno.test("scanDetailLine names the inviter for a guest pass only", () => {
  assertEquals(scanDetailLine("guest", "Ada O."), "Plus-one · Invited by Ada O.");
  assertEquals(scanDetailLine("guest", null), "Plus-one");
  assertEquals(scanDetailLine("primary", "Ada O."), "Primary guest");
  assertEquals(scanDetailLine(null, null), "Primary guest");
});

Deno.test("normalisePlusGuests tolerates old and malformed shapes", () => {
  assertEquals(normalisePlusGuests(null), []);
  assertEquals(normalisePlusGuests("x"), []);
  const out = normalisePlusGuests([
    { id: "g1", name: null, invitedByName: "Ada O.", claimed: false },
    { id: "g2", name: "Sam", checkedInAt: "2026-11-19T10:00:00Z", claimed: true, onMingla: true },
    null,
    { name: "" },
  ]);
  assertEquals(out.length, 3);
  assertEquals(out[0].name, "Ada's guest");
  assertEquals(out[0].claimed, false);
  assertEquals(out[1].claimed, true);
  assertEquals(out[1].checkedInAt, "2026-11-19T10:00:00Z");
  assertEquals(out[2].name, "Guest");
  assertEquals(out[2].id, "guest-3");
});

Deno.test("wiring: mapper, detail sheet and scanner use the helpers", () => {
  const svc = Deno.readTextFileSync("mingla-business/src/services/rsvpApprovals.ts");
  assert(svc.includes("normalisePlusGuests(r.plus_checkins)"));
  assert(svc.includes('cleanText(r.guest_name) ?? "Guest"'));
  const sheet = Deno.readTextFileSync("mingla-business/src/components/rsvp/RsvpGuestDetailSheet.tsx");
  assert(sheet.includes("invitedByLine(pg.invitedByName)"));
  assert(sheet.includes("claimStatusLabel(pg.claimed)"));
  const scanner = Deno.readTextFileSync("mingla-business/src/components/rsvp/RsvpAdmissionScanner.native.tsx");
  assert(scanner.includes("scanDetailLine(result.entityType, result.invitedByName)"));
  const scanSvc = Deno.readTextFileSync("mingla-business/src/services/scanRsvpService.ts");
  assert(scanSvc.includes("invitedByName"));
});
