// Issue #4508 tester adversarial suite: the guest payload, the signed-out
// answer, the guest text and the SMS route, attacked from angles the
// implementor suites do not take.
//
// MINGLA-INVARIANT: I-4508-TESTER-OLD-APP-PAYLOAD | issue #4508 | public-submit-rsvp still accepts every guest shape the pre-#4508 app sends ({name,email,phone,phoneCountryIso} with plusCount), still ignores a stray guest array when plusCount is 0, and refuses the same malformed numbers the old edge refused.
// MINGLA-INVARIANT: I-4508-TESTER-SIGNED-OUT-SHAPE | issue #4508 | a signed-out submit answer carries no guest id, link, account, name, claim or reason even when the database row it is shaped from carries them; only phoneLast4 and willText pass.
// MINGLA-INVARIANT: I-4508-TESTER-GUEST-TEXT | issue #4508 | the guest invite text names the inviter (letters only, at most 24 characters, never a link) and the event, carries the /c/ link, ends with the STOP line and fits one GSM-7 segment even for a very long title; a +234 number routes to Termii and every other mapped number to Twilio at the adapter.
import {
  mapGuestRpcError,
  parseGuests,
  shapeSubmitGuest,
  signedOutGuestGate,
} from "../guestPayload.ts";
import { buildGuestInviteCopy, buildGuestReminderCopy } from "../../rsvp-notify/guestInvite.ts";
import { inviterForText } from "../../_shared/rsvpInviterName.ts";
import {
  composeSmsBody,
  smsProviderForDestination,
} from "../../_shared/adapters/smsAdapter.ts";
import { finalSmsLength } from "../../_shared/sms/buyerSms.ts";

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) throw new Error(message);
};

const LINK = "usemingla.com/c/7KQ2M9XRTD";

Deno.test("old app: a {name,email,phone,phoneCountryIso} party with plusCount is accepted unchanged", () => {
  const r = parseGuests({
    rawGuests: [
      { name: "Typed Name", email: "typed@example.test", phone: "+15550301003", phoneCountryIso: "US" },
      { name: "Second", email: "second@example.test", phone: "+2348030301004", phoneCountryIso: "NG" },
    ],
    rawPlusCount: 2,
    rsvpStatus: "going",
    primaryPhone: "+15550301001",
    signedIn: false,
  });
  assert(r.ok && r.plusCount === 2 && r.guests.length === 2, `old payload accepted: ${JSON.stringify(r)}`);
  assert(r.ok && "phone" in r.guests[1] && r.guests[1].phone === "+2348030301004" &&
    r.guests[1].name === "Second" && r.guests[1].email === "second@example.test",
    "old payload keeps name, email, number and country");
});

Deno.test("old app: plusCount 0 still ignores a stray guest array; not_going ignores guests", () => {
  const stray = parseGuests({
    rawGuests: [{ phone: "not a number" }],
    rawPlusCount: 0,
    rsvpStatus: "going",
    primaryPhone: null,
  });
  assert(stray.ok && stray.guests.length === 0, `plusCount 0 ignores guests: ${JSON.stringify(stray)}`);
  const no = parseGuests({
    rawGuests: [{ phone: "+15550301003" }],
    rawPlusCount: 1,
    rsvpStatus: "not_going",
    primaryPhone: null,
  });
  assert(no.ok && no.guests.length === 0 && no.plusCount === 0, "not_going carries no guests");
});

Deno.test("malformed guests are refused before the write, with the same codes the old edge used", () => {
  const cases: Array<[unknown, number, string]> = [
    [[{ phone: "+1 555 030 1003" }], 1, "rsvp_guest_phone_invalid"],
    [[{ phone: "+0155503010" }], 1, "rsvp_guest_phone_invalid"],
    [[{ phone: "+1234567" }], 1, "rsvp_guest_phone_invalid"],
    [[{ phone: "+1234567890123456" }], 1, "rsvp_guest_phone_invalid"],
    [[{ phone: "+１５５５０３０１００３" }], 1, "rsvp_guest_phone_invalid"],
    [[{ phone: 15550301003 }], 1, "rsvp_guest_contact_required"],
    [[{ phone: "+15550301003\n" }], 1, ""],
    [[{ phone: "+".padEnd(41, "1") }], 1, "rsvp_guest_payload_invalid"],
    [[{ phone: "+15550301003", phoneCountryIso: "us" }], 1, "rsvp_guest_phone_country_invalid"],
    [[{ phone: "+15550301003", phoneCountryIso: 1 }], 1, "rsvp_guest_phone_country_invalid"],
    [[{ phone: "+15550301003", email: "not-an-email" }], 1, "rsvp_guest_email_invalid"],
    [[{ phone: "+15550301003", name: 42 }], 1, "rsvp_guest_keys_invalid"],
    [[{ phone: "+15550301003", nickname: "x" }], 1, "rsvp_guest_keys_invalid"],
    [["+15550301003"], 1, "rsvp_guest_keys_invalid"],
    [[null], 1, "rsvp_guest_keys_invalid"],
    [[{ phone: "+15550301003" }, { phone: "+15550301003" }], 2, "rsvp_guest_duplicate"],
    [[{ phone: "+15550301003" }], 2, "rsvp_guest_count_mismatch"],
  ];
  for (const [rawGuests, rawPlusCount, expected] of cases) {
    const r = parseGuests({ rawGuests, rawPlusCount, rsvpStatus: "going", primaryPhone: null, signedIn: true });
    if (expected === "") {
      // A trailing newline is trimmed by the edge (the database then sees a
      // clean number); it must never reach the database untrimmed.
      assert(r.ok && "phone" in r.guests[0] && r.guests[0].phone === "+15550301003",
        `a trailing newline is trimmed, never passed through: ${JSON.stringify(r)}`);
      continue;
    }
    assert(!r.ok && r.error === expected,
      `${JSON.stringify(rawGuests)} -> ${expected}, got ${JSON.stringify(r)}`);
  }
});

Deno.test("{userId} guests: signed in only, alone, a real uuid, never twice (any case)", () => {
  const id = "45089000-0000-4000-8000-0000000000AB";
  const signedOut = parseGuests({ rawGuests: [{ userId: id }], rawPlusCount: 1, rsvpStatus: "going", primaryPhone: null, signedIn: false });
  assert(!signedOut.ok && signedOut.error === "rsvp_guest_keys_invalid", "signed out cannot pick a friend");
  const mixed = parseGuests({ rawGuests: [{ userId: id, phone: "+15550301003" }], rawPlusCount: 1, rsvpStatus: "going", primaryPhone: null, signedIn: true });
  assert(!mixed.ok && mixed.error === "rsvp_guest_keys_invalid", "a friend pick carries no number");
  const bad = parseGuests({ rawGuests: [{ userId: "x' or 1=1 --" }], rawPlusCount: 1, rsvpStatus: "going", primaryPhone: null, signedIn: true });
  assert(!bad.ok && bad.error === "rsvp_guest_keys_invalid", "a non-uuid userId is refused");
  const twice = parseGuests({
    rawGuests: [{ userId: id }, { userId: id.toLowerCase() }],
    rawPlusCount: 2,
    rsvpStatus: "going",
    primaryPhone: null,
    signedIn: true,
  });
  assert(!twice.ok && twice.error === "rsvp_guest_duplicate", "the same friend in two cases is a duplicate");
});

Deno.test("signed-out answer: nothing beyond phoneLast4 and willText survives, even if the row leaks", () => {
  const leaky = {
    guestId: "45089000-0000-4000-8000-000000000099",
    phoneLast4: "1003",
    onMingla: true,
    displayName: "Gia One",
    claimed: true,
    addedFromFriend: true,
    willText: false,
    notTextedReason: "suppressed",
  };
  const out = shapeSubmitGuest(leaky, { url: "https://usemingla.com/c/7KQ2M9XRTD", code: "7KQ2M9XRTD" }, false);
  assert(out.guestId === null && out.inviteUrl === null && out.inviteCode === null,
    `no id or link signed out: ${JSON.stringify(out)}`);
  assert(out.onMingla === false && out.displayName === null && out.claimed === false &&
    out.addedFromFriend === false && out.notTextedReason === null,
    `no account, name, claim, friend flag or reason signed out: ${JSON.stringify(out)}`);
  assert(out.phoneLast4 === "1003" && out.willText === false, "phoneLast4 and willText pass");
  const signedIn = shapeSubmitGuest(leaky, { url: "https://usemingla.com/c/7KQ2M9XRTD", code: "7KQ2M9XRTD" }, true);
  assert(signedIn.guestId === leaky.guestId && signedIn.inviteUrl !== null && signedIn.notTextedReason === "suppressed",
    "signed in keeps the detail");
});

Deno.test("signed-out gate fails closed on every odd answer", async () => {
  const guests = [{ phone: "+15550301003", phoneCountryIso: null }];
  const throws = await signedOutGuestGate({ signedIn: false, guests, attempt: () => Promise.reject(new Error("boom")) });
  assert(throws?.status === 503, "a thrown count is 503");
  const errored = await signedOutGuestGate({ signedIn: false, guests, attempt: () => Promise.resolve({ data: null, error: { message: "x" } }) });
  assert(errored?.status === 503, "a failed count is 503");
  for (const data of [null, "allowed", { allowed: "true" }, [{ allowed: 1 }], []]) {
    const r = await signedOutGuestGate({ signedIn: false, guests, attempt: () => Promise.resolve({ data, error: null }) });
    assert(r?.status === 429 && r.body.error === "rsvp_guest_daily_cap", `odd answer ${JSON.stringify(data)} refuses`);
  }
  const ok = await signedOutGuestGate({ signedIn: false, guests, attempt: () => Promise.resolve({ data: [{ allowed: true }], error: null }) });
  assert(ok === null, "an allowed array answer passes");
  let called = false;
  const signedIn = await signedOutGuestGate({ signedIn: true, guests, attempt: () => { called = true; return Promise.resolve({ data: null, error: null }); } });
  assert(signedIn === null && !called, "signed in is never counted here");
});

Deno.test("database refusals map to plain codes; unknown errors are not guessed", () => {
  assert(mapGuestRpcError("P4508", "anything")?.status === 429, "P4508 is the daily cap");
  assert(mapGuestRpcError("22023", "rsvp_guest_already_listed")?.status === 409, "already listed is 409");
  assert(mapGuestRpcError("22023", "rsvp_guest_released")?.error === "rsvp_guest_released", "released maps");
  assert(mapGuestRpcError("XX000", "some other failure") === null, "an unknown failure is not a guest refusal");
});

Deno.test("inviter names in texts are letters only, bounded, never a link", () => {
  const cases: Array<[string | null, string]> = [
    ["Ada O.", "Ada O."],
    [null, "A friend"],
    ["", "A friend"],
    ["0800 123 4567", "A friend"],
    ["<script>alert(1)</script>", "scriptalertscript"],
  ];
  for (const [input, expected] of cases) {
    const got = inviterForText(input);
    assert(got === expected, `inviterForText(${JSON.stringify(input)}) = ${JSON.stringify(got)}, want ${expected}`);
  }
  const hostile = inviterForText("Ada http://evil.example/claim?x=1 O.");
  assert(!/[:/.?=0-9]/.test(hostile.replace(/ [A-Z]\.$/, "")), `no link survives: ${hostile}`);
  const long = inviterForText("Bartholomew-Maximilian Featherstonehaugh-Smythe Q.");
  assert(Array.from(long).length <= 24, `bounded to 24: ${long}`);
});

Deno.test("guest invite text: inviter, event, link, STOP line, one segment, any title", () => {
  const short = buildGuestInviteCopy({ inviter: "Ada O.", title: "Rooftop Night", date: "Sat 22 Nov", link: LINK });
  const body = composeSmsBody(short.sms);
  assert(body.startsWith("Mingla: Ada O. is bringing you to Rooftop Night, Sat 22 Nov."), `copy: ${body}`);
  assert(body.includes(LINK) && body.endsWith("Reply STOP to opt out."), `link and STOP: ${body}`);
  assert(finalSmsLength(short.sms) <= 160, `one segment: ${finalSmsLength(short.sms)}`);
  const longTitle = "The Extremely Long Annual Rooftop Summer Solstice Celebration And Silent Disco Extravaganza Featuring Many Guests";
  const long = buildGuestInviteCopy({ inviter: "Bartholomew F.", title: longTitle, date: "Sat 22 Nov", link: LINK });
  assert(finalSmsLength(long.sms) <= 160, `a long title still fits one segment: ${finalSmsLength(long.sms)} ${long.sms}`);
  assert(long.sms.includes(LINK) && long.sms.includes("Bartholomew F."), `link and inviter survive the trim: ${long.sms}`);
  const titled = composeSmsBody(buildGuestInviteCopy({ inviter: "Ada O.", title: "Reply STOP to opt out.", date: null, link: LINK }).sms);
  assert(titled.endsWith(`${LINK} Reply STOP to opt out.`), `a title that reads like the footer never suppresses it: ${titled}`);
  const reminder = buildGuestReminderCopy({ inviter: null, title: "Rooftop Night", link: LINK });
  assert(reminder.sms.includes("A friend saved you a spot") && reminder.sms.includes(LINK), `reminder: ${reminder.sms}`);
});

Deno.test("SMS route at the adapter: +234 to Termii, every other mapped number to Twilio, unmapped or junk to nobody", () => {
  assert(smsProviderForDestination("+2348030301005") === "termii", "Nigeria routes to Termii");
  assert(smsProviderForDestination(" +2348030301005 ") === "termii", "trimmed Nigeria routes to Termii");
  assert(smsProviderForDestination("+15550301003") === "twilio", "US routes to Twilio");
  assert(smsProviderForDestination("+447700900123") === "twilio", "UK routes to Twilio");
  assert(smsProviderForDestination("+33612345678") === "twilio", "France routes to Twilio");
  // An unmapped calling code is never sent (fail closed at the adapter).
  assert(smsProviderForDestination("+233201234567") === null, "Ghana is unmapped and routes nowhere");
  assert(smsProviderForDestination("+0234803030100") === null, "an invalid number routes nowhere");
  assert(smsProviderForDestination(null) === null, "no number routes nowhere");
});
