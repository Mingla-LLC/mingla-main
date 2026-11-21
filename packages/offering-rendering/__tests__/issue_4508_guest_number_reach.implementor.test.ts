// issue #4508 fix round 6 — a guest number from any country is accepted, and
// before submit the form promises a text only when Mingla can send one.
//
//   R5  Explorer resolves a guest number with the shared phone field's parser
//       (any valid international number; a Ghana mobile included), not the
//       nine-country account-number resolver.
//   R6  The client's text-route rule agrees with the server's
//       (countryFromE164, the SMS adapter's routing) for every calling code
//       in the phone picker, and an unroutable number reads "We can't text
//       this number yet. You'll get an invite to send them." in the live
//       preview, the people added and the confirm dialog.
//   P3  Digits with no country picked ask for the country.
//
// FAILS-ON-REVERT: resolve guest numbers with resolveUserPhoneE164 again ->
// R5-1 fails; drop rsvpNotOnMinglaLine / the confirm line rule -> R6-2 / R6-3
// fail; add or drop a calling code on one side only -> R6-1 fails; drop the
// pick-country branch -> P3-1 fails.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { resolveRsvpGuestPhone } from "../../../app-mobile/src/utils/rsvpGuestPhone.ts";
import { resolveUserPhoneE164 } from "../../card-identity/phone.mjs";
import { COUNTRY_DIRECTORY } from "../../phone-input/countryDirectory.ts";
import { countryFromE164 } from "../../../supabase/functions/_shared/e164Country.ts";
import {
  RSVP_GUEST_TEXT_CALLING_CODES,
  rsvpGuestNumberTextable,
} from "../rsvpGuestTextRoute.ts";
import {
  RSVP_GUEST_CANT_TEXT_YET,
  RSVP_GUEST_GETS_TEXT_AND_PASS,
  RSVP_PARTY_COPY,
  addableFromPreview,
  friendGuest,
  numberPreview,
  rsvpNotOnMinglaLine,
} from "../rsvpGuestPartyModel.ts";

const NOT_ON_MINGLA = {
  valid: true,
  isYou: false,
  onMingla: false,
  alreadyOnList: false,
  released: false,
  user: null,
};

Deno.test("R5-1: a valid Ghana mobile is accepted under Ghana (and typed with +233)", () => {
  assertEquals(resolveRsvpGuestPhone("24 123 4567", "GH"), "+233241234567");
  assertEquals(resolveRsvpGuestPhone("+233 24 123 4567", "GH"), "+233241234567");
  assertEquals(resolveRsvpGuestPhone("+233 24 123 4567", null), "+233241234567");
  // The account-number resolver this replaced refused it.
  assertEquals(resolveUserPhoneE164("24 123 4567", "GH"), null);
});

Deno.test("R5-2: the nine account countries still resolve the same, and junk is refused", () => {
  assertEquals(resolveRsvpGuestPhone("(415) 555-0123", "US"), "+14155550123");
  assertEquals(resolveRsvpGuestPhone("0803 123 4567", "NG"), "+2348031234567");
  assertEquals(resolveRsvpGuestPhone("07700 900123", "GB"), "+447700900123");
  assertEquals(resolveRsvpGuestPhone("12", "GH"), null);
  assertEquals(resolveRsvpGuestPhone("415 555 0123", null), null);
});

Deno.test("R6-1: the text route agrees with the server for every picker country", () => {
  for (const country of COUNTRY_DIRECTORY) {
    const sample = `${country.dialCode}2025550123`.slice(0, 13);
    const server = /^\+[1-9][0-9]{7,14}$/.test(sample) && countryFromE164(sample) !== null;
    assertEquals(
      rsvpGuestNumberTextable(sample),
      server,
      `${country.code} ${sample}: client ${rsvpGuestNumberTextable(sample)} vs server ${server}`,
    );
  }
  for (const code of RSVP_GUEST_TEXT_CALLING_CODES) {
    assert(countryFromE164(`${code}2025550123`) !== null, `${code} is routable on the server`);
  }
});

Deno.test("R6-2: the live preview says a text goes only when one can", () => {
  const ghana = numberPreview({
    phone: "+233241234567",
    phoneCountryIso: "GH",
    party: [],
    ownPhones: [],
    lookup: { state: "done", result: NOT_ON_MINGLA },
  });
  assert(ghana.kind === "ready");
  assertEquals(ghana.line, "We can't text this number yet. You'll get an invite to send them.");
  assertEquals(RSVP_GUEST_CANT_TEXT_YET, "We can't text this number yet. You'll get an invite to send them.");
  const us = numberPreview({
    phone: "+14155550123",
    phoneCountryIso: "US",
    party: [],
    ownPhones: [],
    lookup: { state: "done", result: NOT_ON_MINGLA },
  });
  assert(us.kind === "ready");
  assertEquals(us.line, RSVP_PARTY_COPY.notOnMingla);
  // A failed lookup keeps the same rule.
  const unchecked = numberPreview({
    phone: "+491512345678",
    phoneCountryIso: "DE",
    party: [],
    ownPhones: [],
    lookup: { state: "failed" },
  });
  assert(unchecked.kind === "unchecked");
  assertEquals(unchecked.line, RSVP_GUEST_CANT_TEXT_YET);
  // The people-added row uses the same line.
  assertEquals(rsvpNotOnMinglaLine("+491512345678"), RSVP_GUEST_CANT_TEXT_YET);
  assertEquals(rsvpNotOnMinglaLine("+2348031234567"), RSVP_PARTY_COPY.notOnMingla);
});

Deno.test("R6-3: the confirm dialog line is set when the guest is added", () => {
  const add = (phone: string) => {
    const preview = numberPreview({
      phone,
      phoneCountryIso: null,
      party: [],
      ownPhones: [],
      lookup: { state: "done", result: NOT_ON_MINGLA },
    });
    const guest = addableFromPreview(preview);
    assert(guest !== null);
    return guest;
  };
  assertEquals(add("+233241234567").confirmLine, RSVP_GUEST_CANT_TEXT_YET);
  assertEquals(add("+447700900123").confirmLine, RSVP_GUEST_GETS_TEXT_AND_PASS);
  assertEquals(RSVP_GUEST_GETS_TEXT_AND_PASS, "Gets a text and a pass");
  const friend = friendGuest({
    userId: "u1",
    displayName: "Kofi",
    username: null,
    avatarUrl: null,
    closeFriend: false,
  });
  assertEquals(friend.confirmLine, RSVP_GUEST_GETS_TEXT_AND_PASS);
  // The eager RSVP body reads the guest's own line, never a fixed promise.
  const body = Deno.readTextFileSync(new URL("../RsvpOfferingBody.tsx", import.meta.url));
  assert(body.includes("line: g.confirmLine,"));
  assert(!body.includes("RSVP_GUEST_GETS_TEXT_AND_PASS"));
});

Deno.test("P3-1: digits with no country picked ask for the country", () => {
  assertEquals(RSVP_PARTY_COPY.pickCountry, "Pick a country first");
  const block = Deno.readTextFileSync(new URL("../RsvpGuestPartyBlock.tsx", import.meta.url));
  assert(/p\.numberCountry === null && !p\.numberRaw\.trim\(\)\.startsWith\("\+"\)\s*\?\s*RSVP_PARTY_COPY\.pickCountry/.test(block));
  assert(block.includes("errorText: guestNumberError,"));
});
