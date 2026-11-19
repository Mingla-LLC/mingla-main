// Issue #4508 1.9 / amendment 4 / 2.5 — public-submit-rsvp's guest contract.
//
// MINGLA-INVARIANT: I-4508-SUBMIT-ACCEPTS-BOTH-GUEST-SHAPES | issue #4508 | public-submit-rsvp accepts a plus-one as {phone, phoneCountryIso} and still accepts the old {name, email, phone} guest; it refuses the inviter's own number and duplicates before the write, maps the database's refusals (plus-one limit, already listed, released, daily cap) to plain error codes, and a signed-out guest_lookup or guest_bring is refused (rsvp_guest_sign_in_required) before anything is read.
//
// fails-on-revert: restoring the name+email requirement reds the number-only
// case; dropping the T1 signed-out refusal reds the lookup case.
import {
  digitsOf,
  mapGuestRpcError,
  parseGuests,
  rsvpClientKey,
  shapeSubmitGuest,
  signedOutGuestGate,
} from "../guestPayload.ts";
import { rsvpGuestDisplayName } from "../../_shared/rsvpGuestName.ts";
import { type GuestOpsDeps, handleGuestOp } from "../guestOps.ts";

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) throw new Error(message);
};

const EVENT = "45080000-1111-4111-8111-111111111111";
const GUEST = "45080000-3333-4333-8333-333333333333";

Deno.test("a number-only guest is accepted and plusCount may be omitted", () => {
  const r = parseGuests({
    rawGuests: [{ phone: "+15550104508", phoneCountryIso: "US" }],
    rawPlusCount: undefined,
    rsvpStatus: "going",
    primaryPhone: "+15550104501",
  });
  assert(r.ok && r.plusCount === 1, JSON.stringify(r));
  // R-10: narrow the union before reading a number guest's fields.
  const first = r.ok ? r.guests[0] : undefined;
  assert(
    first !== undefined && "phone" in first &&
      first.phone === "+15550104508" && !("name" in first),
    "no name sent",
  );
});

Deno.test("the old {name,email,phone} guest is still accepted", () => {
  const r = parseGuests({
    rawGuests: [{
      name: "Typed",
      email: "typed@example.test",
      phone: "+15550104508",
    }],
    rawPlusCount: 1,
    rsvpStatus: "maybe",
    primaryPhone: null,
  });
  const typed = r.ok ? r.guests[0] : undefined;
  assert(
    typed !== undefined && "phone" in typed && typed.name === "Typed" &&
      typed.email === "typed@example.test",
    JSON.stringify(r),
  );
});

Deno.test("refusals before the write", () => {
  const cases: Array<[unknown, unknown, string]> = [
    [
      [{ phone: "+15550104555" }, { phone: "+15550104555" }],
      2,
      "rsvp_guest_duplicate",
    ],
    [[{ phone: "5550104555" }], 1, "rsvp_guest_phone_invalid"],
    [[{ phone: "" }], 1, "rsvp_guest_contact_required"],
    [[{ phone: "+15550104555", email: "nope" }], 1, "rsvp_guest_email_invalid"],
    [
      [{ phone: "+15550104555", phoneCountryIso: "usa" }],
      1,
      "rsvp_guest_phone_country_invalid",
    ],
    [[{ phone: "+15550104555", nickname: "x" }], 1, "rsvp_guest_keys_invalid"],
    [[{ phone: "+15550104555" }], 2, "rsvp_guest_count_mismatch"],
  ];
  for (const [rawGuests, rawPlusCount, error] of cases) {
    const r = parseGuests({
      rawGuests,
      rawPlusCount,
      rsvpStatus: "going",
      primaryPhone: "+15550104501",
    });
    assert(!r.ok && r.error === error, `${error}: ${JSON.stringify(r)}`);
  }
  const notGoing = parseGuests({
    rawGuests: [{ phone: "+15550104555" }],
    rawPlusCount: 1,
    rsvpStatus: "not_going",
    primaryPhone: null,
  });
  assert(
    notGoing.ok && notGoing.guests.length === 0,
    "not going brings nobody",
  );
  assert(digitsOf("+1 (555) 010-4508") === "15550104508", "digits");
});

Deno.test("database refusals map to plain codes", () => {
  assert(
    mapGuestRpcError("P4508", "rsvp_guest_daily_cap")?.status === 429,
    "cap",
  );
  assert(
    mapGuestRpcError("22023", "rsvp_plus_ones_exceeded")?.error ===
      "rsvp_plus_ones_exceeded",
    "limit",
  );
  assert(
    mapGuestRpcError("22023", "rsvp_guest_already_listed")?.status === 409,
    "listed",
  );
  assert(
    mapGuestRpcError("22023", "rsvp_guest_released")?.status === 409,
    "released",
  );
  assert(
    mapGuestRpcError("XX000", "something else") === null,
    "unknown stays a 500",
  );
});

function opsDeps(userId: string | null, rpcResults: Record<string, unknown>) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const drained: string[] = [];
  const deps: GuestOpsDeps = {
    rpc: (name, args) => {
      calls.push({ name, args });
      if (name === "pg_venue_order_rate_limit_hit") {
        return Promise.resolve({
          data: { allowed: rpcResults.allowed !== false },
          error: null,
        });
      }
      if (name === "rsvp_guest_lookup_day_hit") {
        return Promise.resolve({
          data: { allowed: rpcResults.dayAllowed !== false },
          error: null,
        });
      }
      if (name === "mint_claim_link") {
        return Promise.resolve({ data: { code: "ABCDEFGHJK" }, error: null });
      }
      const value = rpcResults[name];
      return Promise.resolve(
        value instanceof Error
          ? { data: null, error: { message: value.message, code: "22023" } }
          : { data: value, error: null },
      );
    },
    userId,
    ip: "203.0.113.9",
    pepper: () => "fixture-pepper",
    drain: (rsvpId) => {
      drained.push(rsvpId);
      return Promise.resolve();
    },
  };
  return { deps, calls, drained };
}

Deno.test("guest_lookup: T1 signed out is refused before the number is read", async () => {
  const { deps, calls } = opsDeps(null, {
    rsvp_guest_lookup: {
      valid: true,
      onMingla: true,
      user: { id: "x", displayName: "Leak" },
    },
  });
  for (const phone of ["+15550104508", "12345", "+15550104999"]) {
    const r = await handleGuestOp({ op: "guest_lookup", eventId: EVENT, phone }, deps);
    assert(
      r.status === 403 &&
        JSON.stringify(r.body) === '{"error":"rsvp_guest_sign_in_required"}',
      `T1: a signed-out lookup is the one refusal: ${JSON.stringify(r)}`,
    );
  }
  assert(calls.length === 0, "T1: a signed-out lookup reaches no counter and no database read");
});

Deno.test("guest_lookup: signed in sees the account", async () => {
  const { deps, calls } = opsDeps("45080000-0000-4000-8000-000000000011", {
    rsvp_guest_lookup: {
      valid: true,
      onMingla: true,
      user: { displayName: "Gus Grant" },
    },
  });
  const r = await handleGuestOp({
    op: "guest_lookup",
    eventId: EVENT,
    phone: "+15550104508",
  }, deps);
  assert(
    (r.body.user as Record<string, unknown>)?.displayName === "Gus Grant",
    JSON.stringify(r),
  );
  assert(
    calls.some((c) =>
      c.name === "rsvp_guest_lookup" && c.args.p_viewer !== null
    ),
    "viewer passed",
  );
});

Deno.test("guest_lookup: a signed-in account has a daily ceiling of 200", async () => {
  const user = "45080000-0000-4000-8000-000000000011";
  const body = { op: "guest_lookup", eventId: EVENT, phone: "+15550104508" };
  const open = opsDeps(user, { rsvp_guest_lookup: { valid: true } });
  const ok = await handleGuestOp(body, open.deps);
  const day = open.calls.find((c) => c.name === "rsvp_guest_lookup_day_hit");
  assert(ok.status === 200, "under the ceiling answers");
  assert(
    day?.args.p_user_id === user && day?.args.p_limit === 200,
    `the day counter is asked about this account at 200: ${JSON.stringify(day)}`,
  );
  const spent = opsDeps(user, { dayAllowed: false, rsvp_guest_lookup: { valid: true } });
  const refused = await handleGuestOp(body, spent.deps);
  assert(
    refused.status === 429 && refused.body.error === "rate_limited",
    `past the ceiling is the same rate_limited answer: ${JSON.stringify(refused)}`,
  );
  assert(
    !spent.calls.some((c) => c.name === "rsvp_guest_lookup"),
    "a refused lookup never reaches the database lookup",
  );
  const out = opsDeps(null, { dayAllowed: false, rsvp_guest_lookup: { valid: true } });
  await handleGuestOp(body, out.deps);
  assert(out.calls.length === 0, "T1: signed-out callers are refused before any counter");
});

Deno.test("guest_bring: signed in only; added drains and returns the invite link", async () => {
  const anon = await handleGuestOp(
    { op: "guest_bring", guestId: GUEST, phone: "+15550104950" },
    opsDeps(null, {}).deps,
  );
  assert(
    anon.status === 403 && anon.body.error === "rsvp_guest_sign_in_required",
    `T1: signed out gets the one refusal: ${JSON.stringify(anon)}`,
  );
  const { deps, drained } = opsDeps("45080000-0000-4000-8000-000000000012", {
    rsvp_guest_bring: { outcome: "added", guestId: "g-new", rsvpId: "r-1" },
  });
  const ok = await handleGuestOp(
    {
      op: "guest_bring",
      guestId: GUEST,
      phone: "+15550104950",
      phoneCountryIso: "US",
    },
    deps,
  );
  assert(
    ok.status === 200 &&
      ok.body.inviteUrl === "https://usemingla.com/c/ABCDEFGHJK",
    JSON.stringify(ok),
  );
  assert(drained[0] === "r-1", "the new guest's text is sent now");
  const off = await handleGuestOp(
    { op: "guest_bring", guestId: GUEST, phone: "+15550104950" },
    opsDeps("u", { rsvp_guest_bring: { outcome: "not_allowed" } }).deps,
  );
  assert(
    off.status === 409 && off.body.error === "not_allowed",
    JSON.stringify(off),
  );
  const own = await handleGuestOp(
    { op: "guest_bring", guestId: GUEST, phone: "+15550104950" },
    opsDeps("u", { rsvp_guest_bring: new Error("rsvp_guest_own_number") }).deps,
  );
  assert(
    own.status === 400 && own.body.error === "rsvp_guest_own_number",
    JSON.stringify(own),
  );
});

// ---- Wave A rework -----------------------------------------------------------
const FRIEND = "45080000-4444-4444-8444-444444444444";

Deno.test("C1: a signed-in inviter may send a friend as {userId}", () => {
  const r = parseGuests({
    rawGuests: [{ userId: FRIEND }, { phone: "+15550104508" }],
    rawPlusCount: 2,
    rsvpStatus: "going",
    primaryPhone: "+15550104501",
    signedIn: true,
  });
  assert(
    r.ok && JSON.stringify(r.guests[0]) === JSON.stringify({ userId: FRIEND }),
    `the friend is passed by account only: ${JSON.stringify(r)}`,
  );
});

Deno.test("C1: {userId} is refused signed out, mixed with a number, or twice", () => {
  const cases: Array<[unknown, boolean, string]> = [
    [[{ userId: FRIEND }], false, "rsvp_guest_keys_invalid"],
    [
      [{ userId: FRIEND, phone: "+15550104508" }],
      true,
      "rsvp_guest_keys_invalid",
    ],
    [[{ userId: "not-a-uuid" }], true, "rsvp_guest_keys_invalid"],
    [
      [{ userId: FRIEND }, { userId: FRIEND.toUpperCase() }],
      true,
      "rsvp_guest_duplicate",
    ],
  ];
  for (const [rawGuests, signedIn, error] of cases) {
    const r = parseGuests({
      rawGuests,
      rawPlusCount: (rawGuests as unknown[]).length,
      rsvpStatus: "going",
      primaryPhone: "+15550104501",
      signedIn,
    });
    assert(!r.ok && r.error === error, `${error}: ${JSON.stringify(r)}`);
  }
  assert(
    mapGuestRpcError("22023", "rsvp_guest_not_friend")?.status === 400,
    "not a friend maps to a 400",
  );
});

Deno.test("P3-6: the inviter's own number is left to the database (old apps re-send it)", () => {
  const r = parseGuests({
    rawGuests: [{ name: "Live Case", email: "a@b.co", phone: "+15550104501" }],
    rawPlusCount: 1,
    rsvpStatus: "going",
    primaryPhone: "+15550104501",
    signedIn: true,
  });
  assert(
    r.ok,
    `an unchanged party guest is not refused at the edge: ${JSON.stringify(r)}`,
  );
});

Deno.test("P1-2: a signed-out inviter is keyed by a salted address hash", async () => {
  const a = await rsvpClientKey("203.0.113.9");
  const again = await rsvpClientKey("203.0.113.9");
  const b = await rsvpClientKey("203.0.113.10");
  assert(/^[0-9a-f]{64}$/.test(a), "the header the database accepts");
  assert(
    a === again && a !== b,
    "stable per address, different across addresses",
  );
  assert(!a.includes("203"), "the raw address never leaves");
});

Deno.test("P1-2 / C3 wiring: the submit sends the client key and passes willText through", async () => {
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assert(
    /\.setHeader\("x-mingla-rsvp-client", inviterClient\)/.test(src) &&
      /submit_event_rsvp_with_delivery/.test(src),
    "the submit RPC carries the signed-out inviter's key header",
  );
  assert(
    /guestsOut\.push\(shapeSubmitGuest\(guest, link, userId !== null\)\)/.test(src),
    "the response guests go through shapeSubmitGuest with the caller's sign-in state",
  );
  assert(
    /signedIn: userId !== null/.test(src),
    "friends by account only when signed in",
  );
});

// ---- Second rework ---------------------------------------------------------

Deno.test("R-1: a signed-out submit with guest numbers is counted first", async () => {
  const calls: number[] = [];
  const gate = await signedOutGuestGate({
    signedIn: false,
    guests: [{ phone: "+15550104508", phoneCountryIso: null }, {
      phone: "+15550104509",
      phoneCountryIso: "US",
    }],
    attempt: (count) => {
      calls.push(count);
      return Promise.resolve({ data: { allowed: true, counted: true }, error: null });
    },
  });
  assert(gate === null && JSON.stringify(calls) === "[2]", "counted, then allowed");
  const refused = await signedOutGuestGate({
    signedIn: false,
    guests: [{ phone: "+15550104508", phoneCountryIso: null }],
    attempt: () => Promise.resolve({ data: { allowed: false }, error: null }),
  });
  assert(
    refused?.status === 429 && refused.body.error === "rsvp_guest_daily_cap",
    "past the allowance the submit never runs: " + JSON.stringify(refused),
  );
  const broken = await signedOutGuestGate({
    signedIn: false,
    guests: [{ phone: "+15550104508", phoneCountryIso: null }],
    attempt: () => Promise.resolve({ data: null, error: { message: "down" } }),
  });
  assert(broken?.status === 503, "fails closed when the count cannot be written");
  let asked = 0;
  for (const input of [
    { signedIn: true, guests: [{ phone: "+15550104508", phoneCountryIso: null }] },
    { signedIn: false, guests: [] },
  ]) {
    assert(
      await signedOutGuestGate({
        ...input,
        attempt: () => {
          asked += 1;
          return Promise.resolve({ data: { allowed: true }, error: null });
        },
      }) === null,
      "signed in, or no guest numbers: nothing to count",
    );
  }
  assert(asked === 0, "the count is only for signed-out guest numbers");
});

// R-1 (third rework): a signed-out caller is answered the same for a number
// already on the list (the database writes no row and returns no id) as for a
// new one. Field by field, the two response entries are identical apart from
// the last four digits the caller typed.
Deno.test("R-1: signed out, a quiet guest and a new guest read the same, field by field", () => {
  // What the database returns for each (submit_event_rsvp, signed out).
  const fresh = {
    guestId: null,
    phoneLast4: "0001",
    onMingla: false,
    displayName: null,
    claimed: false,
    addedFromFriend: false,
    willText: true,
    notTextedReason: null,
  };
  const quiet = { ...fresh, phoneLast4: "0002" };
  // The edge would mint a link only from a guest id; signed out it never does.
  const a = shapeSubmitGuest(fresh, { url: "https://usemingla.com/c/AAAAAAAAAA", code: "AAAAAAAAAA" }, false);
  const b = shapeSubmitGuest(quiet, null, false);
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  assert(JSON.stringify(keysA) === JSON.stringify(keysB), "same keys: " + keysA + " / " + keysB);
  for (const key of keysA) {
    if (key === "phoneLast4") continue;
    assert(
      JSON.stringify(a[key]) === JSON.stringify(b[key]),
      `field ${key} differs: ${JSON.stringify(a[key])} vs ${JSON.stringify(b[key])}`,
    );
  }
  assert(a.guestId === null && a.inviteUrl === null && a.inviteCode === null,
    "signed out: no guest id and no invite link, even when one was passed: " + JSON.stringify(a));
  // A real row reaching the shaper signed out (an older database) is still
  // stripped of its id, link, claim and friend flags.
  const leaked = shapeSubmitGuest(
    { ...fresh, guestId: "g1", claimed: true, addedFromFriend: true },
    { url: "https://usemingla.com/c/BBBBBBBBBB", code: "BBBBBBBBBB" },
    false,
  );
  assert(
    JSON.stringify({ ...leaked, phoneLast4: "x" }) === JSON.stringify({ ...a, phoneLast4: "x" }),
    "an id, a link or a flag never reaches a signed-out caller: " + JSON.stringify(leaked),
  );
  // Signed in keeps the id and the link.
  const inside = shapeSubmitGuest({ ...fresh, guestId: "g1" }, { url: "https://usemingla.com/c/C", code: "C" }, true);
  assert(inside.guestId === "g1" && inside.inviteUrl === "https://usemingla.com/c/C",
    "signed in keeps the id and link: " + JSON.stringify(inside));
  // No 409 code exists for the signed-out quiet cases any more.
  assert(mapGuestRpcError("22023", "rsvp_guest_unavailable") === null,
    "rsvp_guest_unavailable is gone from the contract");
});

Deno.test("R-1 wiring: signed out, no invite link is minted for a guest", async () => {
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assert(
    /const link = userId !== null && typeof guest\.guestId === "string"/.test(src),
    "the link is minted only for a signed-in caller",
  );
});

Deno.test("R-1 wiring: the count runs before the submit, with the client key", async () => {
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  const gateAt = src.indexOf("await signedOutGuestGate(");
  const submitAt = src.indexOf('admin.rpc("submit_event_rsvp_with_delivery"');
  assert(
    gateAt > 0 && submitAt > gateAt &&
      /"rsvp_guest_signed_out_attempt",[\s\S]{0,120}\.setHeader\("x-mingla-rsvp-client", inviterClient\)/
        .test(src) &&
      /if \(gate !== null\) return json\(gate\.status, gate\.body\);/.test(src),
    "the attempt is counted (its own call) before the submit and stops it when refused",
  );
});

Deno.test("R-2: a signed-out caller never learns an account or a reason", () => {
  const row = {
    guestId: "g1",
    phoneLast4: "4508",
    onMingla: true,
    displayName: "Gia Gold",
    willText: false,
    notTextedReason: "suppressed",
  };
  const out = shapeSubmitGuest(row, { url: "https://usemingla.com/c/X", code: "X" }, false);
  assert(
    out.onMingla === false && out.displayName === null &&
      out.notTextedReason === null && out.willText === false,
    "signed out: willText only: " + JSON.stringify(out),
  );
  const inside = shapeSubmitGuest(row, null, true);
  assert(
    inside.onMingla === true && inside.displayName === "Gia Gold" &&
      inside.notTextedReason === "suppressed",
    "signed in keeps the contract: " + JSON.stringify(inside),
  );
  assert(
    shapeSubmitGuest({ ...row, willText: true }, null, true).notTextedReason === null,
    "no reason for a guest who will be texted",
  );
});

Deno.test("R-4 wiring: the caller address follows the shared rule", async () => {
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assert(
    /const ip = requestClientIp\(req\);/.test(src) &&
      /from "\.\.\/_shared\/ticketLinkToken\.ts"/.test(src) &&
      !/x-forwarded-for/.test(src),
    "one address rule (cf-connecting-ip first), not a second one",
  );
});

Deno.test("R-9: a plus-one's pass name follows the 1.11 rule", async () => {
  const asked: string[] = [];
  const name = await rsvpGuestDisplayName({
    rpc: (fn, args) => {
      asked.push(`${fn}:${args.p_guest_id}`);
      return Promise.resolve({ data: "Ada's guest", error: null });
    },
  }, "g1", null);
  assert(name === "Ada's guest" && asked[0] === "rsvp_guest_display_name:g1", name);
  assert(
    await rsvpGuestDisplayName({
      rpc: () => Promise.resolve({ data: null, error: { code: "PGRST" } }),
    }, "g1", "Typed") === "Typed",
    "the stored name only when the database cannot answer",
  );
  const submit = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  const fetch = await Deno.readTextFile(
    new URL("../../rsvp-pass-fetch/index.ts", import.meta.url),
  );
  assert(
    /displayName: await rsvpGuestDisplayName\(/.test(submit) &&
      !/String\(g\.name \?\? "Guest"\)/.test(submit) &&
      /name = await rsvpGuestDisplayName\(admin, String\(guest\.id\), guest\.name\);/.test(fetch) &&
      !/name = guest\.name \?\? "Guest";/.test(fetch),
    "the submit's credentials and the pass PDF both use it",
  );
});

// ---- Fix round 4 -----------------------------------------------------------
import {
  applySmsRoute,
  guestNoticeDispatch,
  signedOutGuestRefusal,
} from "../guestPayload.ts";
import { passAccess } from "../../rsvp-pass-fetch/passAccess.ts";
import { smsProviderForDestination } from "../../_shared/adapters/smsAdapter.ts";
import { countryFromE164 } from "../../_shared/e164Country.ts";

// T1: the refusal is decided from the guest count only, before any number.
Deno.test("T1: any guest from a caller without a session refuses the RSVP; none passes", () => {
  const refused = signedOutGuestRefusal({
    signedIn: false,
    rawGuests: [{ phone: "+15550104508" }],
    rawPlusCount: 1,
    rsvpStatus: "going",
  });
  assert(
    refused?.status === 403 && refused.body.error === "rsvp_guest_sign_in_required",
    JSON.stringify(refused),
  );
  for (const ok of [
    { signedIn: false, rawGuests: [], rawPlusCount: 0, rsvpStatus: "going" },
    { signedIn: false, rawGuests: [{ phone: "x" }], rawPlusCount: 0, rsvpStatus: "maybe" },
    { signedIn: false, rawGuests: [{ phone: "+15550104508" }], rawPlusCount: 1, rsvpStatus: "not_going" },
    { signedIn: true, rawGuests: [{ phone: "+15550104508" }], rawPlusCount: 1, rsvpStatus: "going" },
  ]) {
    assert(signedOutGuestRefusal(ok) === null, `passes: ${JSON.stringify(ok)}`);
  }
  assert(
    signedOutGuestRefusal({ signedIn: false, rawGuests: [{ phone: "+1" }], rawPlusCount: undefined, rsvpStatus: "going" }) !== null,
    "no plusCount: the array's length decides",
  );
  assert(
    mapGuestRpcError("42501", "rsvp_guest_sign_in_required")?.status === 403 &&
      mapGuestRpcError("22023", "rsvp_guest_has_pass")?.status === 409,
    "the database's T1 / T3 refusals map to plain codes",
  );
});

Deno.test("T1 wiring: the refusal runs before contact parsing, guest parsing and every RPC", async () => {
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  const refusal = src.indexOf("const signedOutRefusal = signedOutGuestRefusal(");
  assert(
    refusal > 0 && refusal < src.indexOf("const parsedGuests = parseGuests(") &&
      refusal < src.indexOf('admin.rpc("submit_event_rsvp_with_delivery"') &&
      refusal < src.indexOf('"rsvp_guest_signed_out_attempt"'),
    "the refusal comes first",
  );
});

Deno.test("P3: a number the SMS adapter cannot route reads willText false, unsupported_region", () => {
  const routable = (phone: string) => smsProviderForDestination(phone) !== null;
  const phones: Record<string, string> = {
    gh: "+233201234567",
    us: "+15550104508",
    ng: "+2348030301005",
  };
  const out = applySmsRoute(
    [
      { guestId: "gh", willText: true },
      { guestId: "us", willText: true },
      { guestId: "ng", willText: true },
      { guestId: "held", willText: false, notTextedReason: "number_limit" },
      { guestId: null, willText: true },
    ],
    (id) => phones[id],
    routable,
  );
  assert(out[0].willText === false && out[0].notTextedReason === "unsupported_region", JSON.stringify(out[0]));
  assert(out[1].willText === true && out[2].willText === true, "mapped countries still text");
  assert(out[3].notTextedReason === "number_limit", "an earlier reason is kept");
  assert(out[4].willText === true, "a row with no id is left as the database answered");
  // The function routes by countryFromE164 (no adapter import); it agrees with
  // the adapter's own rule on every kind of number.
  const edgeRule = (phone: string) =>
    /^\+[1-9][0-9]{7,14}$/.test(phone.trim()) && countryFromE164(phone.trim()) !== null;
  for (const phone of ["+233201234567", "+15550104508", "+2348030301005", "+447700900123", "+0234803030100", "+1234", "+4915112345678"]) {
    assert(edgeRule(phone) === routable(phone), `edge and adapter agree on ${phone}`);
  }
});

Deno.test("T3 / P3-T11: notices go through the release path with plain words", () => {
  const own = guestNoticeDispatch({
    kind: "guest_has_own_rsvp",
    userId: "u-inviter",
    guestId: "g1",
    eventId: "e1",
    eventTitle: "Rooftop Night",
    phoneLast4: "1200",
  });
  assert(
    own?.userId === "u-inviter" && own.type === "rsvp_guest_released" && own.skipPush &&
      own.body === "The number ending 1200 RSVPed for Rooftop Night on their own, so they don't need your spot." &&
      own.idempotencyKey === "rsvp_guest_own_rsvp:g1",
    JSON.stringify(own),
  );
  const removed = guestNoticeDispatch({
    kind: "guest_pass_removed",
    userId: "u-guest",
    guestId: "g2",
    eventId: "e1",
    eventTitle: "Rooftop Night",
    inviterName: "Ivy I.",
  });
  assert(
    removed?.userId === "u-guest" && removed.title === "Your guest pass was cancelled" &&
      removed.body.startsWith("Ivy I. is no longer bringing you for Rooftop Night"),
    JSON.stringify(removed),
  );
  assert(guestNoticeDispatch({ kind: "guest_pass_removed", guestId: "g", eventId: "e" }) === null, "no user, no notice");
  assert(guestNoticeDispatch({ kind: "other", userId: "u", guestId: "g", eventId: "e" }) === null, "unknown kind");
});

Deno.test("T3 / P3-T11 wiring: notices are sent and never returned to the caller", async () => {
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assert(/await sendGuestNotices\(admin, result\.guestNotices\)/.test(src), "sent");
  assert(!/guestNotices:/.test(src.slice(src.indexOf("return json(200, {"))), "not in the answer");
});

Deno.test("K: a plus-one's pass is fetchable only once claimed (the inviter keeps theirs)", async () => {
  const base = { role: "guest" as const, ownerUserId: "gia", parentOwnerUserId: "ivy" };
  const pre = passAccess({ ...base, userId: "gia", guestClaimed: false });
  assert(!pre.ok && pre.status === 409 && pre.error === "claim_required", JSON.stringify(pre));
  assert(passAccess({ ...base, userId: "gia", guestClaimed: true }).ok, "claimed (or backfilled legacy): theirs");
  assert(passAccess({ ...base, userId: "ivy", guestClaimed: false }).ok, "the party owner keeps their read");
  const stranger = passAccess({ ...base, userId: "eve", guestClaimed: true });
  assert(!stranger.ok && stranger.status === 403, "anyone else: sign in required");
  assert(
    passAccess({ role: "primary", userId: "ivy", ownerUserId: "ivy", parentOwnerUserId: null, guestClaimed: false }).ok,
    "a primary pass is untouched",
  );
  const src = await Deno.readTextFile(new URL("../../rsvp-pass-fetch/index.ts", import.meta.url));
  const gate = src.indexOf("const access = passAccess(");
  assert(
    gate > 0 && gate < src.indexOf("if (wantsMetadata)") &&
      gate < src.indexOf("const pdf = await buildRsvpPassPdf") &&
      /"id,rsvp_id,matched_user_id,name,qr_code,claimed_at"/.test(src),
    "the claim gate runs before metadata and the PDF",
  );
});

// Kept last: the handler module's clients leave timers behind.
// T1: through the real handler, a signed-out submit with a listed, a released,
// an account's and a new number gets byte-identical answers, and nothing
// (not the database, not the network) is touched.
Deno.test({
  name: "T1: the signed-out answer is byte-identical for every kind of number",
  // The handler module builds clients that keep timers; none touch the network.
  sanitizeOps: false,
  sanitizeResources: false,
}, async () => {
  Deno.env.set("SUPABASE_URL", "http://127.0.0.1:9");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
  const realFetch = globalThis.fetch;
  const fetched: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL) => {
    fetched.push(String(input));
    return Promise.reject(new Error("no network in this test"));
  }) as typeof fetch;
  try {
    const { handler } = await import("../index.ts");
    const answers: string[] = [];
    // listed, released, an account's, new (the same four the tester probed).
    for (const [i, phone] of ["+15550301002", "+15550301003", "+15550301004", "+15550309999"].entries()) {
      const res = await handler(new Request("http://localhost/public-submit-rsvp", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": `198.51.100.${i + 1}` },
        body: JSON.stringify({
          eventId: EVENT,
          rsvpStatus: "going",
          guestName: "Stranger",
          guestEmail: `stranger${i}@example.test`,
          guestPhone: "+15550309001",
          plusCount: 1,
          guests: [{ phone, phoneCountryIso: "US" }],
        }),
      }));
      const headers = [...res.headers.entries()].sort().map(([k, v]) => `${k}:${v}`).join("|");
      answers.push(`${res.status}\n${headers}\n${await res.text()}`);
    }
    assert(new Set(answers).size === 1, `one answer for every number:\n${answers.join("\n---\n")}`);
    assert(
      answers[0].startsWith("403\n") && answers[0].endsWith('{"error":"rsvp_guest_sign_in_required"}'),
      answers[0],
    );
    assert(fetched.length === 0, `no request left the function: ${fetched.join(", ")}`);
  } finally {
    globalThis.fetch = realFetch;
  }
});
