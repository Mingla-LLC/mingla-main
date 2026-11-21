// issue #4508 fix round 8 — keyboard Done bars, guest row labels, the lookup's
// rate-limit words, and a claimed guest's event page. Deno-runnable: the model
// modules are pure; the app wiring is read from source.
//
// FAILS-ON-REVERT:
//   P2-1  the Explorer phone field's own iOS bar back on by default, or the
//         pass sheet's shared bar back -> R8-P2-1 fails.
//   P2-2  a number guest labelled by name alone -> R8-P2-2 fails.
//   P3-1  the claim screen's room back to +64 -> R8-P3-1 fails.
//   P3-2  refocus on the next tick while the picker window is up -> R8-P3-2 fails.
//   Eager size: the submit payload is set on each guest when it is added
//   (on-demand code) -> R8-EAGER fails if the eager body builds it again.
//   P3-3  "Not on Mingla yet" for an unchecked number, or "in a minute" for
//         the daily ceiling -> R8-P3-3 fails.
//   P3-4  the RSVP box or the floating Going bar shown to a claimed guest ->
//         R8-P3-4 fails.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { rsvpGuestRowLabel, submittedGuestLabel } from "../rsvpGuestParty.ts";
import { parseSubmittedGuests } from "../rsvpGuestParse.ts";
import {
  RSVP_GUEST_OWN_NUMBER,
  RSVP_PARTY_COPY,
  numberPreview,
  rsvpLookupFailedMessage,
} from "../rsvpGuestPartyModel.ts";

const read = (path: string): string =>
  Deno.readTextFileSync(new URL(path, import.meta.url));
const app = (path: string): string => read(`../../../app-mobile/src/${path}`);

Deno.test("R8-P2-1: one Done bar on every Explorer phone field", () => {
  const wrapper = app("components/onboarding/PhoneInput.tsx");
  assert(/showDoneAccessory = false,/.test(wrapper), "the field's own iOS bar is off by default");
  assert(wrapper.includes("showDoneAccessory={showDoneAccessory}"), "and passed through");
  // Only a sheet whose window has no shared bar on iOS keeps the field's own.
  const own = [
    "components/activity/RsvpPartyInvites.tsx",
    "components/purchases/AddIdentitySheet.tsx",
    "components/purchases/SendTicketSheet.tsx",
  ];
  for (const file of own) {
    const src = app(file);
    const start = src.indexOf("<PhoneInput");
    const field = src.slice(start, src.indexOf("/>", start));
    assert(/\n\s*showDoneAccessory\n/.test(field), `${file} keeps its own bar`);
  }
  const pass = app("components/activity/RsvpPassSheet.tsx");
  assert(pass.includes("keyboardToolbar={PURCHASE_SHEET_KEYBOARD_TOOLBAR}"), "the pass sheet drops the shared bar on iOS");
  const purchase = app("components/purchases/SheetKeyboardDoneBar.tsx");
  assert(/PURCHASE_SHEET_KEYBOARD_TOOLBAR: "none" \| "dark" =\s*Platform\.OS === "ios" \? "none" : "dark";/.test(purchase));
});

Deno.test("R8-P2-2: two number guests never read the same", () => {
  const guests = parseSubmittedGuests([
    { guestId: "a", phoneLast4: "4567", onMingla: false, displayName: null, claimed: false, willText: false },
    { guestId: "b", phoneLast4: "0143", onMingla: false, displayName: null, claimed: false, willText: true },
  ]);
  assertEquals(guests.map(submittedGuestLabel), ["Number ending 4567", "Number ending 0143"]);
  // An older answer that still names them by the inviter keeps the digits.
  const old = parseSubmittedGuests([
    { guestId: "a", phoneLast4: "4567", displayName: "Andy's guest" },
    { guestId: "b", phoneLast4: "0143", displayName: "Andy's guest" },
  ]);
  assertEquals(old.map(submittedGuestLabel), ["Andy's guest · 4567", "Andy's guest · 0143"]);
  // A friend picked from the list never has digits.
  assertEquals(rsvpGuestRowLabel("Rita Ray", null), "Rita Ray");
  assertEquals(rsvpGuestRowLabel(null, null), "Your guest");
  // The pass sheet's list uses the same rule.
  assert(app("components/activity/RsvpPartyInvites.tsx").includes("rsvpGuestRowLabel(guest.displayName, guest.phoneLast4)"));
});

Deno.test("R8-P3-1: the claim screen keeps the whole button above the Done pill", () => {
  const claim = app("components/rsvpGuest/RsvpGuestClaimScreen.tsx");
  const num = (name: string): number => Number(new RegExp(`const ${name} = (\\d+);`).exec(claim)?.[1]);
  assert(claim.includes("const CLAIM_FIELD_BOTTOM_OFFSET = KEYBOARD_SCROLL_BOTTOM_OFFSET + CLAIM_BUTTON_GAP +"));
  // Room under the field = flat bar (54) + gap + button + breathing + pill
  // margin. Round 7 measured the floating pill at about 53 pt over the
  // keyboard, so the button needs gap + 50 + 53 + breathing at least.
  const room = 54 + num("CLAIM_BUTTON_GAP") + num("CLAIM_BUTTON_HEIGHT") +
    num("CLAIM_BUTTON_BREATHING") + num("FLOATING_DONE_PILL_MARGIN");
  assert(room >= num("CLAIM_BUTTON_GAP") + 50 + 53 + 12, `room under the field: ${room}`);
  assert(claim.includes("gap: { marginTop: CLAIM_BUTTON_GAP }"), "the gap the room counts is the gap drawn");
});

// R8-P3-2 (a refocus delay after the picker) was replaced in round 9 by the
// proven fix at the app-wide bar: issue_4508_round9 R9-P2-A.

Deno.test("R8-P3-3: an unchecked number claims nothing, and each limit has its words", () => {
  const preview = numberPreview({
    phone: "+15550104508",
    phoneCountryIso: "US",
    ownPhones: [],
    party: [],
    lookup: { state: "failed", code: "rate_limited" },
  }) as { kind: string; line: string; message: string };
  assertEquals(preview.kind, "unchecked");
  assert(!preview.line.includes("Not on Mingla"), preview.line);
  assertEquals(preview.line, RSVP_PARTY_COPY.uncheckedTexted);
  assertEquals(preview.message, "Too many lookups. Try again in a minute.");
  assertEquals(rsvpLookupFailedMessage("rate_limited_today"), RSVP_PARTY_COPY.lookupRateLimitedToday);
  assert(RSVP_PARTY_COPY.lookupRateLimitedToday.includes("tomorrow"));
  assert(!RSVP_PARTY_COPY.lookupRateLimitedToday.includes("minute"));
  assertEquals(rsvpLookupFailedMessage("unavailable"), RSVP_PARTY_COPY.lookupFailed);
  const ops = read("../../../supabase/functions/public-submit-rsvp/guestOps.ts");
  assert(ops.includes('export const GUEST_LOOKUP_DAILY_LIMIT_CODE = "rate_limited_today";'));
  assert(ops.includes("}, GUEST_LOOKUP_DAILY_LIMIT_CODE);"), "the daily counter answers with it");
  assertEquals(RSVP_GUEST_OWN_NUMBER, "That's you. Enter a friend's number.");
});

Deno.test("R8-P3-4: a claimed guest sees their pass, not the RSVP box", () => {
  const screen = app("screens/Event/ConsumerEventDetailScreen.tsx");
  assert(screen.includes("hideDecisionBox={claimedGuestPass !== null}"));
  assert(screen.includes("{isRsvp && claimedGuestPass !== null ? null : isRsvp ? ("), "no floating Going bar");
});

Deno.test("R8-EAGER: the eager RSVP body carries no guest-model code", () => {
  const body = read("../RsvpOfferingBody.tsx");
  assert(body.includes("submittedGuests.map((g) => g.payload)"), "the body reads each guest's payload");
  assert(!/buildGuestPayload|isCompleteE164/.test(body.replace(/\/\/.*$/gm, "")), "no guest-model functions in the boot payload");
  const copy = read("../rsvpGuestCopy.ts");
  assert(!/export const (buildGuestPayload|isCompleteE164)/.test(copy), "the eager copy module stays small");
});
