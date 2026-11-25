// #4490 spec 08 O5 part B — venue-till's daily close, drawer, export and Till
// settings actions (dayClose.ts): each reaches its service-role RPC as the
// verified person (on a Till device: the PIN member, the device recorded);
// reopen and export need a fresh PIN on a Till device and then run as the
// approver; settings are never read or changed in a PIN session; bad payloads
// never reach the database; refusals keep their codes; raw errors never leak.
//
// FAILS-ON-REVERT: drop the step-up in dayClose.ts and B3/B4 fail; drop the
// PIN-session refusal of settings and B5 fails; send the device as the actor
// and B2 fails.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createVenueTillHandler, type TillClient } from "./index.ts";
import { dayCloseDate, settingsPatch } from "./dayClose.ts";

const VENUE = "00000000-4490-4000-8000-0000000005a1";
const OTHER_VENUE = "00000000-4490-4000-8000-0000000005a2";
const SALE = "00000000-4490-4000-8000-0000000005c1";
const DEVICE = "00000000-4490-4000-8000-0000000005f5";
const OWNER = "00000000-4490-4000-8000-0000000005f1";
const MEMBER = "00000000-4490-4000-8000-0000000005f2";
const MANAGER = "00000000-4490-4000-8000-0000000005f3";
const MEMBER_ROW = "00000000-4490-4000-8000-0000000005a3";
const REQ = "00000000-4490-4000-8000-0000000005e2";
const TOKEN = Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) =>
  b.toString(16).padStart(2, "0")
).join("");
const PIN = String(
  100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 800000),
).slice(0, 6);
const DAY = "2026-11-21";

type Row = Record<string, unknown>;
type Call = { name: string; params: Row };

const env = (name: string) =>
  ({
    SUPABASE_URL: "http://kong:8000",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  } as Record<string, string>)[name];

function makeClient(
  user: string,
  answer: (
    name: string,
    params: Row,
  ) => { data: unknown; error: unknown } | undefined,
  calls: Call[],
  saleVenue = VENUE,
): TillClient {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () =>
      Promise.resolve({ data: { id: SALE, venue_id: saleVenue }, error: null }),
  };
  return {
    from: () => builder,
    rpc: (name: string, params: Row) => {
      calls.push({ name, params });
      return Promise.resolve(
        answer(name, params) ?? { data: { ok: true, name }, error: null },
      );
    },
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: { id: user } }, error: null }),
    },
  };
}

function req(body: Row, bearer: string | null = "jwt.e30.sig"): Request {
  return new Request("http://local/venue-till", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** An owner on their own phone: not a Till device. */
const ownerAnswer = (
  extra: (
    name: string,
    params: Row,
  ) => { data: unknown; error: unknown } | undefined = () => undefined,
) =>
(name: string, params: Row) => {
  const e = extra(name, params);
  if (e) return e;
  if (name === "issue_4490_pin_gate") return { data: false, error: null };
  return undefined;
};

/** A Till device with a live PIN session for MEMBER. */
const deviceAnswer = (
  extra: (
    name: string,
    params: Row,
  ) => { data: unknown; error: unknown } | undefined = () => undefined,
) =>
(name: string, params: Row) => {
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
  return undefined;
};

const ACTIONS: Array<[string, Row, string]> = [
  ["day_summary", { date: DAY }, "issue_4490_day_summary"],
  [
    "day_close",
    { date: DAY, countedMinor: 12160000, clientRequestId: REQ },
    "issue_4490_day_close",
  ],
  [
    "day_reopen",
    { date: DAY, reason: "Miscounted the float" },
    "issue_4490_day_reopen",
  ],
  ["day_carry_over", { saleId: SALE, date: DAY }, "issue_4490_till_carry_over"],
  ["cash_movements", { date: DAY }, "issue_4490_cash_movements_list"],
  ["cash_movement", {
    date: DAY,
    kind: "paid_out",
    amountMinor: 300000,
    note: "Ice",
    clientRequestId: REQ,
  }, "issue_4490_cash_movement"],
  ["day_export", { date: DAY }, "issue_4490_day_export"],
  ["settings_get", {}, "issue_4490_till_settings_read"],
  [
    "settings_set",
    { patch: { tipsEnabled: false }, expectedVersion: 2 },
    "issue_4490_till_settings_set",
  ],
];

Deno.test("B1 an owner on their own phone: each action reaches its RPC as the owner, with no device", async () => {
  for (const [action, extra, rpcName] of ACTIONS) {
    const calls: Call[] = [];
    const client = makeClient(OWNER, ownerAnswer(), calls);
    const res = await createVenueTillHandler({ env, client: () => client })(
      req({ action, venueId: VENUE, ...extra }),
    );
    assertEquals(res.status, 200, action);
    const call = calls.find((c) => c.name === rpcName);
    assert(
      call,
      `${action} did not call ${rpcName}: ${
        calls.map((c) => c.name).join(",")
      }`,
    );
    assertEquals(call.params.p_actor, OWNER, action);
    if ("p_device_user" in call.params) {
      assertEquals(call.params.p_device_user, null, action);
    }
    assert(
      !calls.some((c) => c.name === "issue_4490_pin_approve"),
      `${action} asked for a PIN on an owner phone`,
    );
  }
});

Deno.test("B2 on a Till device in a PIN session: the close runs as the member and records the device", async () => {
  for (
    const action of [
      "day_summary",
      "day_close",
      "day_carry_over",
      "cash_movement",
      "cash_movements",
    ]
  ) {
    const [, extra, rpcName] = ACTIONS.find((a) => a[0] === action)!;
    const calls: Call[] = [];
    const client = makeClient(DEVICE, deviceAnswer(), calls);
    const res = await createVenueTillHandler({ env, client: () => client })(
      req({ action, venueId: VENUE, staffSession: TOKEN, ...extra }),
    );
    assertEquals(res.status, 200, action);
    const call = calls.find((c) => c.name === rpcName)!;
    assertEquals(call.params.p_actor, MEMBER, action);
    assertEquals(call.params.p_device_user, DEVICE, action);
  }
});

Deno.test("B3 reopen on a Till device needs a fresh PIN; with it the reopen runs as the approver", async () => {
  const calls: Call[] = [];
  const client = makeClient(DEVICE, deviceAnswer(), calls);
  const handle = createVenueTillHandler({ env, client: () => client });
  let res = await handle(
    req({
      action: "day_reopen",
      venueId: VENUE,
      staffSession: TOKEN,
      date: DAY,
      reason: "Miscounted",
    }),
  );
  assertEquals(res.status, 403);
  assertEquals((await res.json()).code, "pin_step_up_required");
  assert(!calls.some((c) => c.name === "issue_4490_day_reopen"));

  const calls2: Call[] = [];
  const client2 = makeClient(
    DEVICE,
    deviceAnswer((name) =>
      name === "issue_4490_pin_approve"
        ? {
          data: { ok: true, approverUserId: MANAGER, approvalId: "ap1" },
          error: null,
        }
        : undefined
    ),
    calls2,
  );
  res = await createVenueTillHandler({ env, client: () => client2 })(req({
    action: "day_reopen",
    venueId: VENUE,
    staffSession: TOKEN,
    date: DAY,
    reason: "Miscounted",
    stepUp: { pin: PIN, memberId: "00000000-4490-4000-8000-0000000005a4" },
  }));
  assertEquals(res.status, 200);
  const approve = calls2.find((c) => c.name === "issue_4490_pin_approve")!;
  assertEquals(approve.params.p_purpose, "reopen");
  assertEquals(approve.params.p_target, `${VENUE}:${DAY}`);
  const reopen = calls2.find((c) => c.name === "issue_4490_day_reopen")!;
  assertEquals(reopen.params.p_actor, MANAGER);
  assertEquals(reopen.params.p_device_user, DEVICE);
  assertEquals(reopen.params.p_reason, "Miscounted");
});

Deno.test("B4 export on a Till device needs a fresh PIN; a wrong PIN keeps its tries-left answer and exports nothing", async () => {
  const calls: Call[] = [];
  const client = makeClient(
    DEVICE,
    deviceAnswer((name) =>
      name === "issue_4490_pin_approve"
        ? { data: { ok: false, reason: "wrong", triesLeft: 3 }, error: null }
        : undefined
    ),
    calls,
  );
  const res = await createVenueTillHandler({ env, client: () => client })(req({
    action: "day_export",
    venueId: VENUE,
    staffSession: TOKEN,
    date: DAY,
    stepUp: { pin: PIN },
  }));
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.code, "pin_wrong");
  assertEquals(body.triesLeft, 3);
  assertEquals(
    calls.find((c) => c.name === "issue_4490_pin_approve")!.params.p_purpose,
    "export",
  );
  assert(!calls.some((c) => c.name === "issue_4490_day_export"));
});

Deno.test("B5 settings are never read or changed in a PIN session, whoever is switched in", async () => {
  for (const action of ["settings_get", "settings_set"]) {
    const [, extra] = ACTIONS.find((a) => a[0] === action)!;
    const calls: Call[] = [];
    const client = makeClient(DEVICE, deviceAnswer(), calls);
    const res = await createVenueTillHandler({ env, client: () => client })(
      req({ action, venueId: VENUE, staffSession: TOKEN, ...extra }),
    );
    assertEquals(res.status, 403, action);
    assertEquals((await res.json()).code, "not_authorized", action);
    assert(
      !calls.some((c) => c.name.startsWith("issue_4490_till_settings")),
      action,
    );
  }
});

Deno.test("B6 bad payloads never reach the database", async () => {
  const bad: Row[] = [
    { action: "day_close", date: DAY, countedMinor: -1, clientRequestId: REQ },
    { action: "day_close", date: DAY, countedMinor: 1.5, clientRequestId: REQ },
    { action: "day_close", date: DAY, countedMinor: 100 },
    { action: "day_close", countedMinor: 100, clientRequestId: REQ },
    {
      action: "day_close",
      date: "2026-02-30",
      countedMinor: 100,
      clientRequestId: REQ,
    },
    { action: "day_summary", date: "21/11/2026" },
    { action: "day_reopen", date: DAY, reason: "  " },
    { action: "day_reopen", date: DAY, reason: "x".repeat(141) },
    {
      action: "cash_movement",
      kind: "paid_out",
      amountMinor: 100,
      clientRequestId: REQ,
    },
    {
      action: "cash_movement",
      kind: "float",
      amountMinor: 0,
      clientRequestId: REQ,
    },
    {
      action: "cash_movement",
      kind: "tip_jar",
      amountMinor: 100,
      clientRequestId: REQ,
    },
    {
      action: "cash_movement",
      kind: "float",
      amountMinor: 100,
      clientRequestId: "nope",
    },
    { action: "day_carry_over", saleId: "nope", date: DAY },
    { action: "day_export" },
    {
      action: "settings_set",
      patch: { dayStartsAt: "05:00" },
      expectedVersion: 1,
    },
    { action: "settings_set", patch: {}, expectedVersion: 1 },
    { action: "settings_set", patch: { tipsEnabled: true } },
  ];
  for (const body of bad) {
    const calls: Call[] = [];
    const client = makeClient(OWNER, ownerAnswer(), calls);
    const res = await createVenueTillHandler({ env, client: () => client })(
      req({ venueId: VENUE, ...body }),
    );
    assertEquals(res.status, 400, JSON.stringify(body));
    assert(
      calls.every((c) => c.name === "issue_4490_pin_gate"),
      `${JSON.stringify(body)}: ${calls.map((c) => c.name)}`,
    );
  }
});

Deno.test("B7 refusals keep their codes and status; a raw database error is till_failed", async () => {
  const cases: Array<
    [{ code: string; message: string; details?: string }, number, string]
  > = [
    [
      { code: "PT409", message: "day_checks_open", details: '{"remaining":2}' },
      409,
      "day_checks_open",
    ],
    [
      { code: "PT409", message: "day_already_closed" },
      409,
      "day_already_closed",
    ],
    [
      { code: "PT409", message: "day_reopen_too_late" },
      409,
      "day_reopen_too_late",
    ],
    [{ code: "42501", message: "not_authorized" }, 403, "not_authorized"],
    [{ code: "P0001", message: "till_not_enabled" }, 422, "till_not_enabled"],
    [
      { code: "28000", message: "pin_session_required" },
      401,
      "pin_session_required",
    ],
    [{ code: "22023", message: "day_out_of_range" }, 400, "day_out_of_range"],
    [
      { code: "XX000", message: 'relation "venue_day_closes" secret detail' },
      500,
      "till_failed",
    ],
  ];
  for (const [error, status, code] of cases) {
    const client = makeClient(
      OWNER,
      ownerAnswer((name) =>
        name === "issue_4490_day_close" ? { data: null, error } : undefined
      ),
      [],
    );
    const res = await createVenueTillHandler({ env, client: () => client })(
      req({
        action: "day_close",
        venueId: VENUE,
        date: DAY,
        countedMinor: 0,
        clientRequestId: REQ,
      }),
    );
    assertEquals(res.status, status, code);
    const body = await res.json();
    assertEquals(body.code, code);
    assert(!JSON.stringify(body).includes("secret"));
    if (code === "day_checks_open") assertEquals(body.remaining, 2);
  }
});

Deno.test("B8 a check at another venue cannot be moved from this one; signed out is 401", async () => {
  const calls: Call[] = [];
  const client = makeClient(OWNER, ownerAnswer(), calls, OTHER_VENUE);
  const res = await createVenueTillHandler({ env, client: () => client })(
    req({ action: "day_carry_over", venueId: VENUE, saleId: SALE, date: DAY }),
  );
  assertEquals(res.status, 404);
  assertEquals((await res.json()).code, "till_sale_not_found");
  assert(!calls.some((c) => c.name === "issue_4490_till_carry_over"));
  const out = await createVenueTillHandler({
    env,
    client: () => makeClient(OWNER, ownerAnswer(), []),
  })(
    req({ action: "day_summary", venueId: VENUE, date: DAY }, null),
  );
  assertEquals(out.status, 401);
});

Deno.test("B9 helpers: only real calendar dates; the settings patch never carries a day start", () => {
  assertEquals(dayCloseDate("2026-11-21"), "2026-11-21");
  assertEquals(dayCloseDate("2026-02-30"), null);
  assertEquals(dayCloseDate("2026-11-21T00:00"), null);
  assertEquals(settingsPatch({ dayStartsAt: "05:00" }), null);
  assertEquals(settingsPatch({ autoLockMinutes: 3, screenStations: ["bar"] }), {
    autoLockMinutes: 3,
    screenStations: ["bar"],
  });
});
