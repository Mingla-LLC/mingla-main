// #4490 spec 08 O5 part A — venue-till on a shared Till device login: every
// Till action needs a live PIN session and runs as that member (their own
// rights, the device recorded); refunds and sent voids need a fresh PIN with
// money rights; an account that is not a Till device is unchanged; PINs and
// tokens never reach a log or an error.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createVenueTillHandler,
  PIN_ACCOUNT_ACTIONS,
  type TillClient,
} from "./index.ts";
import {
  jwtAuthSessionId,
  staffTokenHash,
} from "../_shared/venueTillStaffSession.ts";

const VENUE = "00000000-4490-4000-8000-0000000000a1";
const BRAND = "00000000-4490-4000-8000-0000000000b0";
const SALE = "00000000-4490-4000-8000-0000000000c1";
const SESSION = "00000000-4490-4000-8000-0000000000c2";
const DEVICE = "00000000-4490-4000-8000-0000000000f5";
const OWNER = "00000000-4490-4000-8000-0000000000f1";
const MEMBER = "00000000-4490-4000-8000-0000000000f2";
const MANAGER = "00000000-4490-4000-8000-0000000000f3";
const MEMBER_ROW = "00000000-4490-4000-8000-0000000000a2";
const MANAGER_ROW = "00000000-4490-4000-8000-0000000000a3";
const PAYMENT = "00000000-4490-4000-8000-0000000000e1";
const ITEM = "00000000-4490-4000-8000-0000000000e3";
const REQ = "00000000-4490-4000-8000-0000000000e2";
const AUTH_SESSION = "7d1c2b3a-4490-4000-8000-00000000abcd";
// Generated at runtime so no fixed secret lives in the repo.
const TOKEN = Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) =>
  b.toString(16).padStart(2, "0")
).join("");
const PIN = String(
  100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 800000),
).slice(0, 6);

type Row = Record<string, unknown>;
type Call = { name: string; params: Row };

function jwtFor(sessionId: string | null, amr?: unknown): string {
  const claims: Row = { sub: "x", role: "authenticated" };
  if (sessionId) claims.session_id = sessionId;
  if (amr) claims.amr = amr;
  const b64 = btoa(JSON.stringify(claims)).replace(/\+/g, "-").replace(
    /\//g,
    "_",
  ).replace(/=+$/, "");
  return `e30.${b64}.sig`;
}

const SALE_ROW = {
  id: SALE,
  venue_id: VENUE,
  brand_id: BRAND,
  session_id: SESSION,
  qr_spot_id: null,
  currency: "NGN",
  state: "open",
  version: 3,
  check_label: null,
};

function fakeFrom(table: string) {
  const data: Row | null = table === "venue_till_sales"
    ? SALE_ROW
    : table === "venue_till_payments"
    ? {
      id: PAYMENT,
      sale_id: SALE,
      method: "cash",
      venue_till_sales: { venue_id: VENUE },
    }
    : table === "venue_till_lines"
    ? { id: ITEM, venue_till_sales: { venue_id: VENUE } }
    : null;
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    is: () => builder,
    not: () => builder,
    // [TEST-MOD-APPROVED #4490] 08-O5 fix 3: with no PIN gate function the edge reads the
    // account's venue grants (fail closed for a Till device); this fake has none.
    contains: () => builder,
    limit: () => Promise.resolve({ data: [], error: null }),
    maybeSingle: () => Promise.resolve({ data, error: null }),
    single: () => Promise.resolve({ data, error: null }),
  };
  return builder;
}

function makeClient(
  user: string,
  answer: (
    name: string,
    params: Row,
  ) => { data: unknown; error: unknown } | undefined,
  calls: Call[],
): TillClient {
  return {
    from: fakeFrom,
    rpc: (name: string, params: Row) => {
      calls.push({ name, params });
      const r = answer(name, params);
      return Promise.resolve(
        r ??
          {
            data: { id: SALE, version: 4, state: "open", lines: [] },
            error: null,
          },
      );
    },
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: { id: user } }, error: null }),
    },
  };
}

const env = (name: string) =>
  ({
    SUPABASE_URL: "http://kong:8000",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  } as Record<string, string>)[name];

function req(body: Row, jwt = jwtFor(AUTH_SESSION)): Request {
  return new Request("http://local/venue-till", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  });
}

/** A device whose token is live: resolve answers the member. */
function deviceAnswer(
  extra: (
    name: string,
    params: Row,
  ) => { data: unknown; error: unknown } | undefined = () => undefined,
) {
  return (name: string, params: Row) => {
    const e = extra(name, params);
    if (e) return e;
    if (name === "issue_4490_pin_gate") return { data: true, error: null };
    if (name === "issue_4490_pin_session_resolve") {
      return {
        data: {
          sessionId: "s1",
          memberId: MEMBER_ROW,
          memberUserId: MEMBER,
          deviceUserId: DEVICE,
        },
        error: null,
      };
    }
    if (name === "issue_4490_can_sell") return { data: true, error: null };
    return undefined;
  };
}

// Every Till action a device may only take inside a PIN session (spec 08 §3 O5).
const SESSION_ACTIONS: Array<[string, Row]> = [
  ["catalog", {}],
  ["checks", {}],
  ["sale", { saleId: SALE }],
  ["quote", { saleId: SALE }],
  ["servers", {}],
  ["open", { idempotencyKey: "open-key-0001" }],
  ["add_menu", {
    saleId: SALE,
    idempotencyKey: "menu-key-0001",
    lines: [{ menuItemId: ITEM, quantity: 1 }],
  }],
  ["add_offer", {
    saleId: SALE,
    idempotencyKey: "offr-key-0001",
    offeringId: ITEM,
    lines: [{ priceOptionId: ITEM, guests: 1 }],
  }],
  ["add_balance", {
    saleId: SALE,
    idempotencyKey: "bal-key-00001",
    groupId: ITEM,
    amountMinor: 100,
  }],
  ["void", {
    saleId: SALE,
    orderItemId: ITEM,
    reason: "wrong",
    expectedVersion: 3,
  }],
  ["send", { saleId: SALE }],
  ["relabel", { saleId: SALE, label: "T2", expectedVersion: 3 }],
  ["set_server", { saleId: SALE, serverUserId: MEMBER, expectedVersion: 3 }],
  ["pay_cash", {
    saleId: SALE,
    amountMinor: 100,
    tipMinor: 0,
    cashGivenMinor: 100,
    clientRequestId: REQ,
    expectedVersion: 3,
  }],
  ["pay_own_machine", {
    saleId: SALE,
    amountMinor: 100,
    tipMinor: 0,
    clientRequestId: REQ,
    expectedVersion: 3,
  }],
  ["pay_room", { saleId: SALE, expectedVersion: 3 }],
  ["pay_tap_start", {
    saleId: SALE,
    tipMinor: 0,
    clientRequestId: REQ,
    expectedVersion: 3,
  }],
  ["pay_code_create", {
    saleId: SALE,
    tipMinor: 0,
    clientRequestId: REQ,
    expectedVersion: 3,
  }],
  ["pay_card_cancel", { paymentId: PAYMENT }],
  ["pay_code_status", { code: "ABCDEFGH" }],
  ["pay_code_cancel", { code: "ABCDEFGH" }],
  ["pay_code_text", { code: "ABCDEFGH", phone: "+2348031234567" }],
  ["keep_late", { paymentId: PAYMENT, expectedVersion: 3 }],
  ["refund", {
    paymentId: PAYMENT,
    amountMinor: 100,
    tipMinor: 0,
    reason: "wrong",
    clientRequestId: REQ,
  }],
  ["receipt", { paymentId: PAYMENT, email: "guest@example.com" }],
  ["set_split", { saleId: SALE, mode: "even", count: 2, expectedVersion: 3 }],
  ["close_covered", { saleId: SALE, expectedVersion: 3 }],
  ["seat", { spotId: ITEM, idempotencyKey: "seat-key-0001" }],
  ["start_session", {
    saleId: SALE,
    offeringId: ITEM,
    minutes: 60,
    idempotencyKey: "sess-key-0001",
    expectedVersion: 3,
  }],
  ["extend_session", {
    saleId: SALE,
    lineId: ITEM,
    minutes: 30,
    idempotencyKey: "extn-key-0001",
    expectedVersion: 3,
  }],
  // TEST-MOD-APPROVED #4490 (08-O5 part B): the daily close, the drawer, export
  // and the Till settings are Till actions too: refused on a device without a
  // live PIN session before any other RPC (settings are then refused in the
  // session as well; dayClose.issue4490.o5b proves that row).
  ["day_summary", { date: "2026-11-21" }],
  ["day_close", { date: "2026-11-21", countedMinor: 100, clientRequestId: REQ }],
  ["day_reopen", { date: "2026-11-21", reason: "Miscounted" }],
  ["day_carry_over", { saleId: SALE, date: "2026-11-21" }],
  ["cash_movements", { date: "2026-11-21" }],
  ["cash_movement", { kind: "float", amountMinor: 100, clientRequestId: REQ }],
  ["day_export", { date: "2026-11-21" }],
  ["settings_get", {}],
  ["settings_set", { patch: { tipsEnabled: false }, expectedVersion: 1 }],
];

const SAFE_RPCS = new Set([
  "issue_4490_pin_gate",
  "issue_4490_pin_session_resolve",
]);

Deno.test("O5A-E1 a Till device without a PIN session is refused every Till action before any other RPC", async () => {
  for (const [action, extra] of SESSION_ACTIONS) {
    const calls: Call[] = [];
    const client = makeClient(
      DEVICE,
      (name) =>
        name === "issue_4490_pin_gate"
          ? { data: true, error: null }
          : undefined,
      calls,
    );
    const res = await createVenueTillHandler({ env, client: () => client })(
      req({ action, venueId: VENUE, ...extra }),
    );
    assertEquals(res.status, 401, action);
    assertEquals((await res.json()).code, "pin_session_required", action);
    assert(
      calls.every((c) => SAFE_RPCS.has(c.name)),
      `${action}: ${calls.map((c) => c.name).join(",")}`,
    );
  }
});

Deno.test("O5A-E2 an ended, expired, idle, foreign or malformed session token is refused", async () => {
  for (
    const token of [TOKEN, "not-a-token", TOKEN.toUpperCase(), TOKEN + "00"]
  ) {
    const calls: Call[] = [];
    const client = makeClient(DEVICE, (name) => {
      if (name === "issue_4490_pin_gate") return { data: true, error: null };
      if (name === "issue_4490_pin_session_resolve") {
        return {
          data: null,
          error: { code: "28000", message: "pin_session_invalid" },
        };
      }
      return undefined;
    }, calls);
    const res = await createVenueTillHandler({ env, client: () => client })(
      req({
        action: "pay_cash",
        venueId: VENUE,
        staffSession: token,
        saleId: SALE,
        amountMinor: 100,
        tipMinor: 0,
        cashGivenMinor: 100,
        clientRequestId: REQ,
        expectedVersion: 3,
      }),
    );
    assertEquals(res.status, 401);
    const code = (await res.json()).code;
    assert(
      code === "pin_session_invalid" || code === "pin_session_required",
      code,
    );
    assert(!calls.some((c) => c.name === "issue_4490_till_take_payment"));
  }
});

Deno.test("O5A-E3 in a PIN session the payment runs as the member and records the device; only the token's sha256 travels", async () => {
  const calls: Call[] = [];
  const client = makeClient(
    DEVICE,
    deviceAnswer((name) =>
      name === "issue_4490_till_take_payment"
        ? {
          data: {
            paymentId: PAYMENT,
            method: "cash",
            amountMinor: 100,
            tipMinor: 0,
            state: "paid",
            replayed: false,
          },
          error: null,
        }
        : undefined
    ),
    calls,
  );
  const res = await createVenueTillHandler({ env, client: () => client })(
    req({
      action: "pay_cash",
      venueId: VENUE,
      staffSession: TOKEN,
      saleId: SALE,
      amountMinor: 100,
      tipMinor: 0,
      cashGivenMinor: 100,
      clientRequestId: REQ,
      expectedVersion: 3,
    }),
  );
  assertEquals(res.status, 200);
  const pay = calls.find((c) => c.name === "issue_4490_till_take_payment");
  assertEquals(pay?.params.p_actor, MEMBER);
  assertEquals(pay?.params.p_device_user, DEVICE);
  const resolve = calls.find((c) =>
    c.name === "issue_4490_pin_session_resolve"
  );
  assertEquals(resolve?.params.p_token_hash, await staffTokenHash(TOKEN));
  assertEquals(resolve?.params.p_device_user, DEVICE);
  assertEquals(resolve?.params.p_venue_id, VENUE);
  assertEquals(resolve?.params.p_auth_session, AUTH_SESSION);
  assert(
    !JSON.stringify(calls).includes(TOKEN),
    "the raw token never reaches the database",
  );
});

Deno.test("O5A-E4 an account that is not a Till device acts as itself, exactly as before (no session, no resolve)", async () => {
  const calls: Call[] = [];
  const client = makeClient(OWNER, (name) => {
    if (name === "issue_4490_pin_gate") return { data: false, error: null };
    if (name === "issue_4490_till_take_payment") {
      return {
        data: {
          paymentId: PAYMENT,
          method: "cash",
          amountMinor: 100,
          tipMinor: 0,
          state: "paid",
        },
        error: null,
      };
    }
    return undefined;
  }, calls);
  const res = await createVenueTillHandler({ env, client: () => client })(
    req({
      action: "pay_cash",
      venueId: VENUE,
      saleId: SALE,
      amountMinor: 100,
      tipMinor: 0,
      cashGivenMinor: 100,
      clientRequestId: REQ,
      expectedVersion: 3,
    }),
  );
  assertEquals(res.status, 200);
  const pay = calls.find((c) => c.name === "issue_4490_till_take_payment");
  assertEquals(pay?.params.p_actor, OWNER);
  assertEquals(pay?.params.p_device_user, OWNER);
  assert(!calls.some((c) => c.name === "issue_4490_pin_session_resolve"));
});

Deno.test("O5A-E5 before the PIN migration (no pin_gate) nobody is gated; any other gate error fails closed", async () => {
  const calls: Call[] = [];
  const client = makeClient(DEVICE, (name) => {
    if (name === "issue_4490_pin_gate") {
      return {
        data: null,
        error: { code: "PGRST202", message: "Could not find the function" },
      };
    }
    if (name === "issue_4490_till_take_payment") {
      return { data: { paymentId: PAYMENT, state: "paid" }, error: null };
    }
    return undefined;
  }, calls);
  const res = await createVenueTillHandler({ env, client: () => client })(
    req({
      action: "pay_cash",
      venueId: VENUE,
      saleId: SALE,
      amountMinor: 100,
      tipMinor: 0,
      cashGivenMinor: 100,
      clientRequestId: REQ,
      expectedVersion: 3,
    }),
  );
  assertEquals(res.status, 200);
  assertEquals(
    calls.find((c) => c.name === "issue_4490_till_take_payment")?.params
      .p_actor,
    DEVICE,
  );
  const calls2: Call[] = [];
  const broken = makeClient(
    DEVICE,
    (name) =>
      name === "issue_4490_pin_gate"
        ? { data: null, error: { code: "57014", message: "timeout" } }
        : undefined,
    calls2,
  );
  const res2 = await createVenueTillHandler({ env, client: () => broken })(
    req({
      action: "pay_cash",
      venueId: VENUE,
      saleId: SALE,
      amountMinor: 100,
      tipMinor: 0,
      cashGivenMinor: 100,
      clientRequestId: REQ,
      expectedVersion: 3,
    }),
  );
  assertEquals(res2.status, 500);
  assert(!calls2.some((c) => c.name === "issue_4490_till_take_payment"));
});

Deno.test("O5A-E6 a refund on a Till device needs a fresh PIN; it runs as whoever approved it", async () => {
  const body = {
    action: "refund",
    venueId: VENUE,
    staffSession: TOKEN,
    paymentId: PAYMENT,
    amountMinor: 100,
    tipMinor: 0,
    reason: "wrong",
    clientRequestId: REQ,
  };
  // No step-up: refused, no refund.
  let calls: Call[] = [];
  let client = makeClient(DEVICE, deviceAnswer(), calls);
  let res = await createVenueTillHandler({ env, client: () => client })(
    req(body),
  );
  assertEquals(res.status, 403);
  assertEquals((await res.json()).code, "pin_step_up_required");
  assert(!calls.some((c) => c.name === "issue_4490_till_refund"));
  // Wrong PIN: tries left, no refund.
  calls = [];
  client = makeClient(
    DEVICE,
    deviceAnswer((name) =>
      name === "issue_4490_pin_approve"
        ? { data: { ok: false, reason: "wrong", triesLeft: 3 }, error: null }
        : undefined
    ),
    calls,
  );
  res = await createVenueTillHandler({ env, client: () => client })(
    req({ ...body, stepUp: { pin: PIN } }),
  );
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { code: "pin_wrong", triesLeft: 3 });
  assert(!calls.some((c) => c.name === "issue_4490_till_refund"));
  // The member has no money rights: refused with its own code.
  calls = [];
  client = makeClient(
    DEVICE,
    deviceAnswer((name) =>
      name === "issue_4490_pin_approve"
        ? { data: { ok: false, reason: "no_rights" }, error: null }
        : undefined
    ),
    calls,
  );
  res = await createVenueTillHandler({ env, client: () => client })(
    req({ ...body, stepUp: { pin: PIN } }),
  );
  assertEquals((await res.json()).code, "pin_no_rights");
  // A manager approves on the spot: the refund runs as the manager, device recorded.
  calls = [];
  client = makeClient(
    DEVICE,
    deviceAnswer((name) =>
      name === "issue_4490_pin_approve"
        ? {
          data: { ok: true, approverUserId: MANAGER, approvalId: "a1" },
          error: null,
        }
        : name === "issue_4490_till_refund"
        ? { data: { refundId: "r1" }, error: null }
        : undefined
    ),
    calls,
  );
  res = await createVenueTillHandler({ env, client: () => client })(
    req({ ...body, stepUp: { pin: PIN, memberId: MANAGER_ROW } }),
  );
  assertEquals(res.status, 200);
  const approve = calls.find((c) => c.name === "issue_4490_pin_approve");
  assertEquals(approve?.params.p_purpose, "refund");
  assertEquals(approve?.params.p_member, MANAGER_ROW);
  assertEquals(approve?.params.p_target, PAYMENT);
  const refund = calls.find((c) => c.name === "issue_4490_till_refund");
  assertEquals(refund?.params.p_actor, MANAGER);
  assertEquals(refund?.params.p_device_user, DEVICE);
});

Deno.test("O5A-E7 a void on a Till device goes through the device wrapper; a step-up marks it and runs as the approver", async () => {
  const body = {
    action: "void",
    venueId: VENUE,
    staffSession: TOKEN,
    saleId: SALE,
    orderItemId: ITEM,
    reason: "wrong",
    expectedVersion: 3,
  };
  let calls: Call[] = [];
  let client = makeClient(
    DEVICE,
    deviceAnswer((name) =>
      name === "issue_4490_till_void_on_device"
        ? {
          data: null,
          error: { code: "P0001", message: "pin_step_up_required" },
        }
        : undefined
    ),
    calls,
  );
  let res = await createVenueTillHandler({ env, client: () => client })(
    req(body),
  );
  assertEquals((await res.json()).code, "pin_step_up_required");
  const plain = calls.find((c) => c.name === "issue_4490_till_void_on_device");
  assertEquals(plain?.params.p_stepped_up, false);
  assertEquals(plain?.params.p_actor, MEMBER);
  assert(
    !calls.some((c) => c.name === "issue_4490_till_void"),
    "a device never calls the plain void",
  );
  calls = [];
  client = makeClient(
    DEVICE,
    deviceAnswer((name) =>
      name === "issue_4490_pin_approve"
        ? {
          data: { ok: true, approverUserId: MANAGER, approvalId: "a1" },
          error: null,
        }
        : undefined
    ),
    calls,
  );
  res = await createVenueTillHandler({ env, client: () => client })(
    req({ ...body, stepUp: { pin: PIN, memberId: MANAGER_ROW } }),
  );
  assertEquals(res.status, 200);
  const stepped = calls.find((c) =>
    c.name === "issue_4490_till_void_on_device"
  );
  assertEquals(stepped?.params.p_stepped_up, true);
  assertEquals(stepped?.params.p_actor, MANAGER);
  assertEquals(stepped?.params.p_device_user, DEVICE);
  assertEquals(
    calls.find((c) => c.name === "issue_4490_pin_approve")?.params.p_purpose,
    "void_sent",
  );
});

Deno.test("O5A-E8 Who's selling: unlock returns the session token once; refusals map to copy codes", async () => {
  const cases: Array<[Row, number, Row]> = [
    [{ ok: false, reason: "wrong", triesLeft: 2 }, 403, {
      code: "pin_wrong",
      triesLeft: 2,
    }],
    [{ ok: false, reason: "wrong", triesLeft: null }, 403, {
      code: "pin_wrong",
      triesLeft: null,
    }],
    [
      { ok: false, reason: "locked", lockedUntil: "2028-01-01T00:05:00Z" },
      403,
      { code: "pin_locked", lockedUntil: "2028-01-01T00:05:00Z" },
    ],
    [{ ok: false, reason: "hard_locked" }, 403, { code: "pin_hard_locked" }],
    [{ ok: false, reason: "device_limited" }, 429, {
      code: "pin_device_limited",
    }],
  ];
  for (const [answer, status, expected] of cases) {
    const calls: Call[] = [];
    const client = makeClient(
      DEVICE,
      (name) =>
        name === "issue_4490_pin_unlock"
          ? { data: answer, error: null }
          : undefined,
      calls,
    );
    const res = await createVenueTillHandler({ env, client: () => client })(
      req({
        action: "pin_unlock",
        venueId: VENUE,
        memberId: MEMBER_ROW,
        pin: PIN,
      }),
    );
    assertEquals(res.status, status);
    assertEquals(await res.json(), expected);
  }
  const calls: Call[] = [];
  const client = makeClient(
    DEVICE,
    (name) =>
      name === "issue_4490_pin_unlock"
        ? {
          data: {
            ok: true,
            token: TOKEN,
            sessionId: "s1",
            expiresAt: "x",
            autoLockMinutes: 2,
            member: { memberId: MEMBER_ROW },
          },
          error: null,
        }
        : undefined,
    calls,
  );
  const res = await createVenueTillHandler({ env, client: () => client })(
    req({
      action: "pin_unlock",
      venueId: VENUE,
      memberId: MEMBER_ROW,
      pin: PIN,
    }),
  );
  assertEquals(res.status, 200);
  const data = (await res.json()).data;
  assertEquals(data.staffSession, TOKEN);
  assertEquals(data.autoLockMinutes, 2);
  assertEquals(calls[0].params.p_auth_session, AUTH_SESSION);
  // A malformed PIN never reaches the database.
  const calls2: Call[] = [];
  const c2 = makeClient(DEVICE, () => undefined, calls2);
  const bad = await createVenueTillHandler({ env, client: () => c2 })(
    req({
      action: "pin_unlock",
      venueId: VENUE,
      memberId: MEMBER_ROW,
      pin: "12a4",
    }),
  );
  assertEquals(bad.status, 400);
  assertEquals(calls2.length, 0);
});

Deno.test("O5A-E9 PIN set and reset are account actions: refused in a PIN session, never venue-scoped", async () => {
  for (const action of PIN_ACCOUNT_ACTIONS) {
    const calls: Call[] = [];
    const client = makeClient(DEVICE, () => undefined, calls);
    const res = await createVenueTillHandler({ env, client: () => client })(
      req({
        action,
        brandId: BRAND,
        memberId: MEMBER_ROW,
        pin: PIN,
        staffSession: TOKEN,
      }),
    );
    assertEquals(res.status, 403, action);
    assertEquals(calls.length, 0, action);
  }
  const calls: Call[] = [];
  const client = makeClient(
    MANAGER,
    (name) =>
      name === "issue_4490_pin_reset"
        ? { data: { ok: true, hadPin: true }, error: null }
        : undefined,
    calls,
  );
  const res = await createVenueTillHandler({ env, client: () => client })(
    req({ action: "pin_reset", memberId: MEMBER_ROW }),
  );
  assertEquals(res.status, 200);
  assertEquals(calls[0].params, { p_actor: MANAGER, p_member: MEMBER_ROW });
  const weak = makeClient(MEMBER, (name) => {
    if (name === "issue_4490_pin_status") {
      return { data: { memberId: MEMBER_ROW }, error: null };
    }
    if (name === "issue_4490_pin_set") {
      return { data: null, error: { code: "22023", message: "pin_weak" } };
    }
    return undefined;
  }, []);
  const res2 = await createVenueTillHandler({ env, client: () => weak })(
    req({ action: "pin_set", brandId: BRAND, pin: "1234" }),
  );
  assertEquals(res2.status, 400);
  assertEquals((await res2.json()).code, "pin_weak");
});

Deno.test("O5A-E10 signing the device out: a manager's PIN or, when no manager has a PIN, the device's fresh email code", async () => {
  // Manager PIN.
  let calls: Call[] = [];
  let client = makeClient(DEVICE, (name) => {
    if (name === "issue_4490_pin_approve") {
      return {
        data: { ok: true, approverUserId: MANAGER, approvalId: "a1" },
        error: null,
      };
    }
    if (name === "issue_4490_pin_sessions_end_all") {
      return { data: 2, error: null };
    }
    return undefined;
  }, calls);
  let res = await createVenueTillHandler({ env, client: () => client })(
    req({
      action: "pin_sign_out",
      venueId: VENUE,
      memberId: MANAGER_ROW,
      pin: PIN,
    }),
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).data.ended, 2);
  assertEquals(
    calls.find((c) => c.name === "issue_4490_pin_approve")?.params.p_purpose,
    "sign_out",
  );
  // No PIN given while a manager has one: refused.
  calls = [];
  client = makeClient(
    DEVICE,
    (name) =>
      name === "issue_4490_pin_staff"
        ? { data: { gated: true, managerHasPin: true, staff: [] }, error: null }
        : undefined,
    calls,
  );
  res = await createVenueTillHandler({ env, client: () => client })(
    req({ action: "pin_sign_out", venueId: VENUE }),
  );
  assertEquals((await res.json()).code, "pin_step_up_required");
  assert(!calls.some((c) => c.name === "issue_4490_pin_sessions_end_all"));
  // Nobody with a PIN: an email code within 10 minutes signs it out; an old one does not.
  for (const [age, expected] of [[60, 200], [3600, 403]] as const) {
    calls = [];
    client = makeClient(DEVICE, (name) => {
      if (name === "issue_4490_pin_staff") {
        return {
          data: { gated: true, managerHasPin: false, staff: [] },
          error: null,
        };
      }
      if (name === "issue_4490_pin_sessions_end_all") {
        return { data: 0, error: null };
      }
      return undefined;
    }, calls);
    const jwt = jwtFor(AUTH_SESSION, [{
      method: "otp",
      timestamp: Math.floor(Date.now() / 1000) - age,
    }]);
    res = await createVenueTillHandler({ env, client: () => client })(
      req({ action: "pin_sign_out", venueId: VENUE }, jwt),
    );
    assertEquals(res.status, expected);
  }
});

Deno.test("O5A-E11 no PIN or token is ever written to a log, even on failures", async () => {
  const seen: string[] = [];
  const orig = {
    error: console.error,
    warn: console.warn,
    log: console.log,
    info: console.info,
  };
  const capture = (...args: unknown[]) => seen.push(args.map(String).join(" "));
  console.error = capture;
  console.warn = capture;
  console.log = capture;
  console.info = capture;
  try {
    for (const fail of ["57014", "XX000"]) {
      const client = makeClient(DEVICE, (name) => {
        if (name === "issue_4490_pin_gate") return { data: true, error: null };
        if (name === "issue_4490_pin_session_resolve") {
          return { data: null, error: { code: fail, message: `boom ${fail}` } };
        }
        if (name === "issue_4490_pin_unlock") {
          return { data: null, error: { code: fail, message: `boom ${fail}` } };
        }
        if (name === "issue_4490_pin_approve") {
          return { data: null, error: { code: fail, message: `boom ${fail}` } };
        }
        return undefined;
      }, []);
      const h = createVenueTillHandler({ env, client: () => client });
      await (await h(
        req({
          action: "pin_unlock",
          venueId: VENUE,
          memberId: MEMBER_ROW,
          pin: PIN,
        }),
      )).text();
      await (await h(
        req({
          action: "pay_cash",
          venueId: VENUE,
          staffSession: TOKEN,
          saleId: SALE,
          amountMinor: 1,
          tipMinor: 0,
          cashGivenMinor: 1,
          clientRequestId: REQ,
          expectedVersion: 3,
        }),
      )).text();
      await (await h(
        req({
          action: "refund",
          venueId: VENUE,
          staffSession: TOKEN,
          paymentId: PAYMENT,
          amountMinor: 1,
          tipMinor: 0,
          reason: "x",
          clientRequestId: REQ,
          stepUp: { pin: PIN },
        }),
      )).text();
    }
  } finally {
    Object.assign(console, orig);
  }
  const all = seen.join("\n");
  assert(!all.includes(PIN), "PIN in a log");
  assert(!all.includes(TOKEN), "token in a log");
});

Deno.test("O5A-E12 the auth session id is read from the verified bearer's claims", () => {
  assertEquals(jwtAuthSessionId(jwtFor(AUTH_SESSION)), AUTH_SESSION);
  assertEquals(jwtAuthSessionId(jwtFor(null)), null);
  assertEquals(jwtAuthSessionId("garbage"), null);
});
