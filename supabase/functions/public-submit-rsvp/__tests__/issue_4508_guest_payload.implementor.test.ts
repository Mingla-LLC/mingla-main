// Issue #4508 1.9 / amendment 4 / 2.5 — public-submit-rsvp's guest contract.
//
// MINGLA-INVARIANT: I-4508-SUBMIT-ACCEPTS-BOTH-GUEST-SHAPES | issue #4508 | public-submit-rsvp accepts a plus-one as {phone, phoneCountryIso} and still accepts the old {name, email, phone} guest; it refuses the inviter's own number and duplicates before the write, maps the database's refusals (plus-one limit, already listed, released, daily cap) to plain error codes, and a signed-out guest_lookup never returns an account.
//
// fails-on-revert: restoring the name+email requirement reds the number-only
// case; dropping the signed-out strip reds the lookup case.
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

Deno.test("guest_lookup: signed out learns only valid, rate-limited by IP", async () => {
  const { deps, calls } = opsDeps(null, {
    rsvp_guest_lookup: {
      valid: true,
      onMingla: true,
      user: { id: "x", displayName: "Leak" },
    },
  });
  const r = await handleGuestOp({
    op: "guest_lookup",
    eventId: EVENT,
    phone: "+15550104508",
  }, deps);
  assert(
    r.status === 200 && JSON.stringify(r.body) === '{"valid":true}',
    `P1-1: a signed-out caller learns only valid: ${JSON.stringify(r)}`,
  );
  assert(
    calls[0].args.p_scope_key === "rsvp_guest_lookup:ip:203.0.113.9",
    "per-IP limit",
  );
  const limited = await handleGuestOp(
    { op: "guest_lookup", eventId: EVENT, phone: "+15550104508" },
    opsDeps(null, { allowed: false }).deps,
  );
  assert(limited.status === 429, "rate limited");
  const bad = await handleGuestOp({
    op: "guest_lookup",
    eventId: EVENT,
    phone: "12345",
  }, deps);
  assert(bad.status === 400, "invalid number");
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

Deno.test("guest_bring: signed in only; added drains and returns the invite link", async () => {
  const anon = await handleGuestOp(
    { op: "guest_bring", guestId: GUEST, phone: "+15550104950" },
    opsDeps(null, {}).deps,
  );
  assert(anon.status === 401, "signed out refused");
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

Deno.test("R-1: the unavailable refusal maps to one plain 409", () => {
  assert(
    JSON.stringify(mapGuestRpcError("22023", "rsvp_guest_unavailable")) ===
      JSON.stringify({ error: "rsvp_guest_unavailable", status: 409 }),
    "rsvp_guest_unavailable is a 409",
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
