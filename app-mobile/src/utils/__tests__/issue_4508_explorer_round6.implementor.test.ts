// @ts-nocheck -- a Deno suite (deno2-discovered); the app tsc has no Deno globals or URL imports.
// issue #4508 fix round 6 — Explorer event sheet and claim screen.
//
//   R2  The RSVP guest fields in the event sheet use the app's sheet input
//       (gorhom BottomSheetTextInput, the pattern AttendanceClaimSheet and
//       RsvpPartyInvites use), the page scrolls a focused guest field near the
//       top of the sheet so the row under it stays above the keyboard, the
//       number field shows only the app-wide Done bar, and the claim screen
//       keeps "Text me a code" above the keyboard with one Done bar.
//   R5  The guest number resolves with the shared phone parser.
//   P3  A claimed guest sees "You're going with {first name}" and Open your
//       pass; a tap in the sheet with the keyboard up runs on the first tap.
//
// The keyboard itself can only be seen on a device; these pin the wiring the
// device run relies on, and the pure pieces exactly.
//
// FAILS-ON-REVERT: give the guest number field the plain input or its own
// Done bar again -> R2-1 fails; drop the reveal -> R2-2 fails; drop the claim
// screen offset or its accessory switch -> R2-3 fails; use the account-number
// resolver for guests -> R5 fails; drop the guest pass state -> P3-1 fails.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  claimedGuestPassFor,
  guestPassHeadline,
} from "../rsvpGuestPassState.ts";

const read = (path: string): string =>
  Deno.readTextFileSync(new URL(path, import.meta.url));
const screen = read("../../screens/Event/ConsumerEventDetailScreen.tsx");

Deno.test("R2-1: the guest number field is the sheet input with one Done bar", () => {
  assert(/args\.role === "plus_one"\s*\?\s*\{ inputComponent: RsvpSheetTextInput, showDoneAccessory: false \}/.test(screen));
  assert(screen.includes("guestInputComponent: RsvpSheetTextInput,"), "the friends search too");
  const input = read("../../components/rsvpGuest/RsvpSheetTextInput.tsx");
  assert(input.includes('import { BottomSheetTextInput } from "../ui/BaseBottomSheet";'));
  assert(input.includes("<BottomSheetTextInput"));
  assert(/sheet\?\.reveal\(inner\.current\)/.test(input), "focus asks the page to reveal the field");
});

Deno.test("R2-2: the page scrolls a focused guest field near the sheet top, with room below", () => {
  assert(screen.includes("<RsvpSheetFieldContext.Provider value={rsvpSheetFieldHandlers}>"));
  assert(/motionScrollY\.current \+ \(fieldY - hostY\) - RSVP_GUEST_FIELD_TOP/.test(screen));
  assert(/detailScrollRef\.current\?\.scrollTo\(\{ y: Math\.max\(target, 0\), animated: true \}\)/.test(screen));
  assert(/rsvpGuestFieldFocused\s*\?\s*scrollPaddingBottom \+ RSVP_GUEST_FIELD_ROOM/.test(screen));
  // No bespoke keyboard plumbing (orch-0892): no listener, no RN avoiding view.
  assert(!/Keyboard\s*\.\s*addListener/.test(screen));
  assert(!screen.includes("automaticallyAdjustKeyboardInsets"));
});

Deno.test("R2-3: the claim screen keeps its button above the keyboard with one Done bar", () => {
  const claim = read("../../components/rsvpGuest/RsvpGuestClaimScreen.tsx");
  assert(claim.includes("keyboardBottomOffset={CLAIM_FIELD_BOTTOM_OFFSET}"));
  // Round 8 sized the room for the whole button (issue_4508_round8 R8-P3-1).
  assert(claim.includes("const CLAIM_FIELD_BOTTOM_OFFSET = KEYBOARD_SCROLL_BOTTOM_OFFSET + CLAIM_BUTTON_GAP +"));
  const phone = claim.slice(claim.indexOf('testID="issue-4508-claim-phone"'));
  assert(phone.slice(0, 300).includes("showDoneAccessory={false}"));
  const ui = read("../../components/programs/ProgramUi.tsx");
  assert(ui.includes("bottomOffset={keyboardBottomOffset}"));
});

Deno.test("R5: a guest number uses the shared parser; the inviter's own keeps #1857", () => {
  assert(/args\.role === "plus_one"\s*\?\s*resolveRsvpGuestPhone\(raw, args\.countryCode\)\s*:\s*resolveUserPhoneE164\(raw, args\.countryCode\)/.test(screen));
  assert(/args\.role === "plus_one"\s*\?\s*resolveRsvpGuestPhone\(args\.rawValue, iso\)\s*:\s*resolveUserPhoneE164\(args\.rawValue, iso\)/.test(screen));
});

Deno.test("P3-1: a claimed guest pass shows as the viewer's state on the event page", () => {
  const rows = [
    { eventId: "e1", role: "guest" as const, invitedBy: "Rita Okafor" },
    { eventId: "e2", role: "primary" as const, invitedBy: null },
  ];
  assertEquals(claimedGuestPassFor(rows, "e1")?.invitedBy, "Rita Okafor");
  assertEquals(claimedGuestPassFor(rows, "e2"), null);
  assertEquals(claimedGuestPassFor(rows, "e3"), null);
  assertEquals(claimedGuestPassFor(undefined, "e1"), null);
  // Their own RSVP on the same event wins.
  assertEquals(claimedGuestPassFor([...rows, { eventId: "e1", role: "primary" as const, invitedBy: null }], "e1"), null);
  assertEquals(guestPassHeadline("Rita Okafor"), "You're going with Rita");
  assertEquals(guestPassHeadline("Rita O."), "You're going with Rita");
  assertEquals(guestPassHeadline(null), "You're going");
  assert(screen.includes("claimedGuestPassFor(myGoingRsvps.data, seed?.eventId ?? null)"));
  assert(/claimedGuestPass !== null \? \(\s*<RsvpGuestPassCard/.test(screen));
  assert(/<RsvpPassSheet\s+visible=\{guestPassOpen\}/.test(screen));
});

Deno.test("P3-2: with the keyboard up, the first tap in the event sheet runs", () => {
  const scroll = screen.slice(screen.indexOf("<BottomSheetScrollView"), screen.indexOf('testID="orch-1138-consumer-event-scroll"'));
  assert(scroll.includes('keyboardShouldPersistTaps="handled"'));
});
