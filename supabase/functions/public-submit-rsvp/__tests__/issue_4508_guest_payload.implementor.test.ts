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
} from "../guestPayload.ts";
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
  assert(
    r.ok && r.guests[0].phone === "+15550104508" && !("name" in r.guests[0]),
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
  assert(
    r.ok && r.guests[0].name === "Typed" &&
      r.guests[0].email === "typed@example.test",
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
    /willText: guest\.willText !== false/.test(src) &&
      /notTextedReason: guest\.willText === false/.test(src),
    "the response says which guests will not be texted",
  );
  assert(
    /signedIn: userId !== null/.test(src),
    "friends by account only when signed in",
  );
});
