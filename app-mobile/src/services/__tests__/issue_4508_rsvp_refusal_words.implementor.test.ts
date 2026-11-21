// @ts-nocheck -- a Deno suite (deno2-discovered); the app tsc has no Deno globals or URL imports.
// issue #4508 R1 — every server refusal reaches its words in the Explorer app.
//
// supabase-js hands a non-2xx edge answer back as a FunctionsHttpError whose
// `context` is the fetch Response, with the `{ error }` code still unread in
// its body. These cases build that REAL error (the @supabase/functions-js
// version the app ships) around a real Response, one per code, and follow the
// code to the words the RSVP body shows (rsvpGuestErrorMessage), the guest
// lookup preview shows (numberPreview) and the bring sheet shows
// (rsvpGuestBringMessage).
//
// FAILS-ON-REVERT: read `error.context.body` as JSON again (the old
// invokeErrorCode) -> every "reaches" case fails (the code becomes the
// fallback); drop the lookup's failed `code` -> L-1 fails.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FunctionsHttpError } from "npm:@supabase/functions-js@2.103.0";

import { readInvokeErrorCode } from "../invokeErrorCode.ts";
import { rsvpGuestBringMessage } from "../../utils/rsvpGuestBringCopy.ts";
import { rsvpGuestErrorMessage } from "../../../../packages/offering-rendering/rsvpGuestErrors.ts";
import {
  RSVP_PARTY_COPY,
  numberPreview,
} from "../../../../packages/offering-rendering/rsvpGuestPartyModel.ts";

const refusal = (code: string, status = 409): FunctionsHttpError =>
  new FunctionsHttpError(
    new Response(JSON.stringify({ error: code }), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );

// The submit path: code -> the guest line the RSVP body shows.
const SUBMIT_WORDS: ReadonlyArray<[string, number, string]> = [
  ["rsvp_guest_has_pass", 409, "You already have a pass for this event from a friend."],
  ["rsvp_plus_ones_exceeded", 400, "That's the most this host allows."],
  ["rsvp_guest_own_number", 400, "That's you. Enter a friend's number."],
  ["rsvp_guest_duplicate", 400, "You've added the same person twice. Remove one and try again."],
  ["rsvp_guest_already_listed", 409, "Someone you're bringing is already on the list. Remove them and try again."],
  ["rsvp_guest_released", 409, "Someone you're bringing can't be invited to this event. Remove them and try again."],
  ["rsvp_guest_not_friend", 400, "You can only add people from your friends list. Add them by phone number instead."],
  ["rsvp_guest_daily_cap", 429, "You've invited a lot of numbers today. Try again tomorrow, or RSVP just for yourself."],
  ["rsvp_guest_phone_invalid", 400, "One of the numbers you added isn't valid. Remove it and add it again."],
  ["rsvp_guest_phone_country_invalid", 400, "One of the numbers you added isn't valid. Remove it and add it again."],
  ["rsvp_guest_contact_required", 400, "Bringing someone isn't available yet. Try again soon."],
  ["rsvp_guest_keys_invalid", 400, "Bringing someone isn't available yet. Try again soon."],
  ["rsvp_guest_sign_in_required", 403, "Update or open the Mingla app to bring someone"],
];

for (const [code, status, words] of SUBMIT_WORDS) {
  Deno.test(`submit: ${code} reaches its words`, async () => {
    const read = await readInvokeErrorCode(refusal(code, status), "rsvp_write_failed");
    assertEquals(read, code);
    assertEquals(rsvpGuestErrorMessage(read), words);
  });
}

// The older RSVP codes on the same path keep the words they have on web: the
// body maps them with rsvpErrorMessageForCode (pinned by the Host web suite
// issue_1902_public_event_acquisition); here the exact code must arrive, and
// no guest line may shadow it.
for (const code of ["rsvp_full", "rsvp_event_ended", "rsvp_not_open", "rsvp_date_unavailable"]) {
  Deno.test(`submit: ${code} reaches the RSVP body unchanged`, async () => {
    const read = await readInvokeErrorCode(refusal(code), "rsvp_write_failed");
    assertEquals(read, code);
    assertEquals(rsvpGuestErrorMessage(read), null);
  });
}

// The bring sheet (op guest_bring) branches on the code.
const BRING_WORDS: ReadonlyArray<[string, number, string]> = [
  ["not_allowed", 409, "This host isn't letting guests bring anyone."],
  ["already_brought", 409, "You've already brought someone to this event."],
  ["rsvp_payload_invalid", 400, "Bringing someone isn't available yet. Try again soon."],
  ["rsvp_guest_already_listed", 409, "That person is already on the list."],
  ["rsvp_guest_own_number", 400, "That's you. Enter a friend's number."],
  ["rate_limited", 429, "Too many tries in a row. Wait a minute, then try again."],
];
for (const [code, status, words] of BRING_WORDS) {
  Deno.test(`bring: ${code} reaches its words`, async () => {
    const read = await readInvokeErrorCode(refusal(code, status), "unavailable");
    assertEquals(read, code);
    assertEquals(rsvpGuestBringMessage(read), words);
  });
}

Deno.test("L-1 lookup: rate_limited says so under the number, never 'unavailable'", async () => {
  const read = await readInvokeErrorCode(refusal("rate_limited", 429), "unavailable");
  assertEquals(read, "rate_limited");
  const preview = numberPreview({
    phone: "+15555550123",
    phoneCountryIso: "US",
    party: [],
    ownPhones: [],
    lookup: { state: "failed", code: read },
  });
  assert(preview.kind === "unchecked");
  assertEquals(preview.message, "Too many lookups. Try again in a minute.");
  assertEquals(RSVP_PARTY_COPY.lookupRateLimited, "Too many lookups. Try again in a minute.");
  // Any other failure keeps the old line.
  const other = numberPreview({
    phone: "+15555550123",
    phoneCountryIso: "US",
    party: [],
    ownPhones: [],
    lookup: { state: "failed", code: "unavailable" },
  });
  assert(other.kind === "unchecked");
  assertEquals(other.message, RSVP_PARTY_COPY.lookupFailed);
});

Deno.test("no code in the body (network, relay page, read body): the caller's fallback", async () => {
  assertEquals(
    await readInvokeErrorCode(new FunctionsHttpError(new Response("<html>bad gateway</html>", { status: 502 })), "rsvp_write_failed"),
    "rsvp_write_failed",
  );
  const consumed = refusal("rsvp_guest_has_pass");
  await (consumed.context as Response).text();
  assertEquals(await readInvokeErrorCode(consumed, "unavailable"), "unavailable");
  assertEquals(await readInvokeErrorCode(new Error("Failed to send a request"), "unavailable"), "unavailable");
  assertEquals(await readInvokeErrorCode(null, "unavailable"), "unavailable");
  // A body already parsed by the caller still counts.
  assertEquals(
    await readInvokeErrorCode({ context: { body: '{"error":"rsvp_full"}' } }, "rsvp_write_failed"),
    "rsvp_full",
  );
});

Deno.test("the body is read from a clone: the response stays readable for anyone after", async () => {
  const err = refusal("rsvp_guest_has_pass");
  assertEquals(await readInvokeErrorCode(err, "x"), "rsvp_guest_has_pass");
  assertEquals(JSON.parse(await (err.context as Response).text()).error, "rsvp_guest_has_pass");
});

Deno.test("every Explorer caller (lookup, submit, bring) reads the code this way", () => {
  const service = Deno.readTextFileSync(
    new URL("../rsvpDeckService.ts", import.meta.url),
  );
  assertEquals(service.match(/await readInvokeErrorCode\(error, "/g)?.length, 3);
  assert(!service.includes("ctx.body"), "the old context.body parse is gone");
});
