// issue #3827 — guest-list edge function, TESTER ADVERSARIAL.
// Different angles from the implementor file: byte (not character) body
// limits at the exact boundary, prototype-key smuggling, PII never echoed from
// an unmapped database error, no database call before validation/auth, strict
// response shapes, the pepper only gating the operations that need it, and
// side effects (dispatch / audit) never running after a refused RPC.
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { createHandler, type GuestListDeps, mapRpcError, parseBody } from "../index.ts";

const EVENT = "11111111-1111-4111-8111-111111111111";
const TIER = "22222222-2222-4222-8222-222222222222";
const REQ = "33333333-3333-4333-8333-333333333333";
const ORDER = "44444444-4444-4444-8444-444444444444";
const TICKET = "55555555-5555-4555-8555-555555555555";
const ACTOR = "66666666-6666-4666-8666-666666666666";

type RpcOut = { data: unknown; error: { message: string; hint?: string | null } | null };

function harness(opts: {
  actor?: string | null;
  rpc?: (fn: string, args: Record<string, unknown>) => RpcOut;
  pepperThrows?: boolean;
  dispatchRejects?: boolean;
  auditRejects?: boolean;
} = {}) {
  const calls: string[] = [];
  const dispatched: string[] = [];
  const audits: string[] = [];
  let pepperReads = 0;
  let actorReads = 0;
  const deps: GuestListDeps = {
    actorId: () => {
      actorReads += 1;
      return Promise.resolve(opts.actor === undefined ? ACTOR : opts.actor);
    },
    rpc: (fn, args) => {
      calls.push(fn);
      return Promise.resolve(opts.rpc ? opts.rpc(fn, args) : { data: {}, error: null });
    },
    pepper: () => {
      pepperReads += 1;
      if (opts.pepperThrows) throw new Error("qr_token_pepper_missing");
      return "tester-pepper-0123456789abcdef0123456789";
    },
    dispatch: (orderId) => {
      dispatched.push(orderId);
      return opts.dispatchRejects ? Promise.reject(new Error("network down")) : Promise.resolve();
    },
    audit: (entry) => {
      audits.push(entry.action);
      return opts.auditRejects ? Promise.reject(new Error("audit down")) : Promise.resolve();
    },
  };
  return {
    handler: createHandler(deps),
    calls,
    dispatched,
    audits,
    pepperReads: () => pepperReads,
    actorReads: () => actorReads,
  };
}

const post = (raw: string) =>
  new Request("https://x/guest-list", {
    method: "POST",
    headers: { authorization: "Bearer user-jwt", "content-type": "application/json" },
    body: raw,
  });

const issue = (guests: unknown[], extra: Record<string, unknown> = {}) => ({
  operation: "issue",
  eventId: EVENT,
  ticketTypeId: TIER,
  eventDateId: null,
  guests,
  note: null,
  clientRequestId: REQ,
  ...extra,
});

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return await res.json() as Record<string, unknown>;
}

Deno.test("#3827 adversarial: the 64 KB limit counts BYTES at the exact boundary, before any auth or RPC", async () => {
  const h = harness();
  // Pad a valid search body with spaces so it is exactly 65,536 bytes.
  const base = JSON.stringify({ operation: "search", eventId: EVENT, query: "ana" });
  const exact = base + " ".repeat(65_536 - new TextEncoder().encode(base).byteLength);
  assertEquals(new TextEncoder().encode(exact).byteLength, 65_536);
  const ok = await h.handler(post(exact));
  assertEquals(ok.status, 200, "exactly 64 KB is accepted");

  const over = exact + " ";
  const h2 = harness();
  const tooBig = await h2.handler(post(over));
  assertEquals(tooBig.status, 413);
  assertEquals((await bodyOf(tooBig)).code, "request_too_large");
  assertEquals(h2.calls.length, 0, "no RPC for an oversize body");
  assertEquals(h2.actorReads(), 0, "auth is not even consulted for an oversize body");

  // Multibyte: 22,000 three-byte characters are < 65,536 characters but > 65,536 bytes.
  const h3 = harness();
  const wide = JSON.stringify({ operation: "search", eventId: EVENT, query: "€".repeat(22_000) });
  assert(wide.length < 65_536 && new TextEncoder().encode(wide).byteLength > 65_536);
  assertEquals((await h3.handler(post(wide))).status, 413, "the limit is bytes, not UTF-16 length");
  assertEquals(h3.calls.length, 0);
});

Deno.test("#3827 adversarial: smuggled keys (actor id, __proto__, extra guest/plus-one keys) are 400 with no RPC", async () => {
  const smuggled = [
    JSON.stringify(issue([{ index: 0, name: "Ana" }], { actorId: ACTOR })),
    JSON.stringify(issue([{ index: 0, name: "Ana" }], { p_actor_id: ACTOR })),
    `{"operation":"search","eventId":"${EVENT}","query":"ana","__proto__":{"admin":true}}`,
    JSON.stringify(issue([{ index: 0, name: "Ana", partySize: 4 }])),
    JSON.stringify(issue([{ index: 0, name: "Ana", compReason: "x" }])),
    JSON.stringify(issue([{ index: 0, name: "Ana", plusOnes: [{ name: "Bo", partySize: 2 }] }])),
    JSON.stringify(issue([{ index: 0, name: "Ana", plusOnes: [{ name: "Bo", email: "not-an-email" }] }])),
    JSON.stringify(issue([{ index: 0, name: "Ana", plusOnes: Array.from({ length: 10 }, () => ({})) }])),
    JSON.stringify(issue([{ index: 0, name: "Ana", plusOnes: { name: "Bo" } }])),
    JSON.stringify(issue([{ index: 50, name: "Ana" }])),
    JSON.stringify(issue([{ index: -1, name: "Ana" }])),
    JSON.stringify(issue([{ index: 0.5, name: "Ana" }])),
    JSON.stringify(issue([{ index: "0", name: "Ana" }])),
    JSON.stringify(issue([{ index: 0, name: "   " }])),
    JSON.stringify(issue([{ index: 0, name: "Ana" }, { index: 0, name: "Bo" }])),
    JSON.stringify(issue([{ index: 0, name: "Ana", phoneE164: "07700900123" }])),
    JSON.stringify(issue([])),
    JSON.stringify(issue([{ index: 0, name: "Ana" }], { note: "n".repeat(201) })),
    JSON.stringify(issue([{ index: 0, name: "Ana" }], { eventDateId: "tonight" })),
    JSON.stringify(issue([{ index: 0, name: "Ana" }], { clientRequestId: undefined })),
    JSON.stringify({ operation: "cancel", orderId: ORDER, reason: "r".repeat(201), clientRequestId: REQ }),
    JSON.stringify({ operation: "cancel", orderId: ORDER, reason: null, clientRequestId: REQ, refund: true }),
    JSON.stringify({ operation: "resend", orderId: ORDER, clientRequestId: REQ, email: "attacker@example.test" }),
    JSON.stringify({ operation: "search", eventId: EVENT, query: "q".repeat(201) }),
    JSON.stringify({ operation: "search", eventId: EVENT, query: ["ana"] }),
    JSON.stringify({ operation: "admit", eventId: EVENT, ticketId: TICKET, qr: "mingla:v1:ticket:x" }),
    JSON.stringify({ operation: "admit", eventId: EVENT, ticketId: "not-a-uuid" }),
    JSON.stringify({ operation: "refund", orderId: ORDER }),
    JSON.stringify([{ operation: "search", eventId: EVENT, query: "ana" }]),
    "null",
    "42",
  ];
  for (const raw of smuggled) {
    const h = harness();
    const res = await h.handler(post(raw));
    assertEquals(res.status, 400, `400 for ${raw.slice(0, 90)}`);
    assertEquals((await bodyOf(res)).code, "invalid_request");
    assertEquals(h.calls.length, 0, `no RPC for ${raw.slice(0, 90)}`);
    assertEquals(h.dispatched.length, 0);
  }
});

Deno.test("#3827 adversarial: 50 guests with 9 plus-ones each parses; the verified actor is the only actor sent", async () => {
  const guests = Array.from({ length: 50 }, (_, i) => ({
    index: i,
    name: `Guest ${i}`,
    email: null,
    phoneE164: null,
    plusOnes: Array.from({ length: 9 }, () => ({ name: null, email: null, phoneE164: null })),
  }));
  const parsed = parseBody(issue(guests));
  assert(parsed !== null && parsed.operation === "issue");
  let sentActor: unknown = null;
  const h = harness({
    rpc: (fn, args) => {
      if (fn === "biz_comp_issue") sentActor = args.p_actor_id;
      return { data: { eventDateId: null, results: [], addedCount: 0, failedCount: 0, remaining: null }, error: null };
    },
  });
  const res = await h.handler(post(JSON.stringify(issue(guests))));
  assertEquals(res.status, 200);
  assertEquals(sentActor, ACTOR);
});

Deno.test("#3827 adversarial: an unmapped database error never echoes its text (PII, constraint names, SQL)", async () => {
  const leaky = [
    'duplicate key value violates unique constraint "orders_comp_live_email_uidx" DETAIL: Key (event_id, lower(buyer_email))=(e, ana@example.test) already exists.',
    "new row for relation \"orders\" violates check constraint \"orders_comp_shape_check\"",
    "permission denied for function biz_comp_issue",
    "comp_origin_required",
    "party_nesting_not_allowed",
    "lead_not_added",
  ];
  for (const message of leaky) {
    const res = mapRpcError({ message, hint: "+447700900123 ana@example.test" });
    assertEquals(res.status, 500, message);
    const text = await res.text();
    assertEquals(JSON.parse(text), { ok: false, code: "internal" });
    assert(!text.includes("@") && !text.includes("+44") && !text.includes("orders_"), "no PII or schema text");
  }
  // A mapped code with a hostile hint: only remaining (number) and ticketName (string) survive.
  const cap = mapRpcError({ message: "ticket_capacity_exceeded", hint: '{"remaining":"3","ticketName":7,"email":"x@y.z"}' });
  assertEquals(await cap.json(), { ok: false, code: "ticket_capacity_exceeded" });
  const capBad = mapRpcError({ message: "ticket_capacity_exceeded", hint: "not json" });
  assertEquals(capBad.status, 409);
  assertEquals(await capBad.json(), { ok: false, code: "ticket_capacity_exceeded" });
  // A non-capacity code never forwards its hint.
  const forbidden = mapRpcError({ message: "forbidden", hint: '{"remaining":2}' });
  assertEquals(await forbidden.json(), { ok: false, code: "forbidden" });
});

Deno.test("#3827 adversarial: responses carry no-store + CORS on success AND on every refusal", async () => {
  const cases: Array<[Request, number]> = [
    [new Request("https://x/guest-list", { method: "GET" }), 405],
    [post("{"), 400],
    [post(JSON.stringify({ operation: "search", eventId: EVENT, query: "ana" })), 200],
  ];
  for (const [req, status] of cases) {
    const h = harness({ rpc: () => ({ data: { orders: [], truncated: false, allowed: true }, error: null }) });
    const res = await h.handler(req);
    assertEquals(res.status, status);
    assertEquals(res.headers.get("cache-control"), "no-store");
    assertEquals(res.headers.get("access-control-allow-origin"), "*");
  }
  const h = harness({ actor: null });
  const res = await h.handler(post(JSON.stringify({ operation: "search", eventId: EVENT, query: "ana" })));
  assertEquals(res.status, 401);
  assertEquals(res.headers.get("cache-control"), "no-store");
  assertEquals(h.calls.length, 0);
  assertEquals(h.pepperReads(), 0, "the pepper is never read for an unauthenticated caller");
});

Deno.test("#3827 adversarial: search answers exactly {ok, orders, truncated}; RPC-level extras at the top are dropped", async () => {
  const h = harness({
    rpc: (fn) =>
      fn === "pg_venue_order_rate_limit_hit"
        ? { data: { allowed: true }, error: null }
        : {
          data: {
            orders: [{ orderId: ORDER, displayName: "Ana", maskedEmail: "an***@example.test", isGuestList: true, cameWithName: null, tickets: [] }],
            truncated: false,
            debugSql: "select * from orders",
            compReason: "VIP list",
          },
          error: null,
        },
  });
  const res = await h.handler(post(JSON.stringify({ operation: "search", eventId: EVENT, query: "an" })));
  const body = await bodyOf(res);
  assertEquals(Object.keys(body).sort(), ["ok", "orders", "truncated"]);
  const text = JSON.stringify(body);
  assert(!text.includes("VIP list") && !text.includes("select *"));
});

Deno.test("#3827 adversarial: the pepper gates only issue/admit; search, cancel and resend work without it", async () => {
  for (const raw of [
    JSON.stringify({ operation: "search", eventId: EVENT, query: "ana" }),
    JSON.stringify({ operation: "cancel", orderId: ORDER, reason: null, clientRequestId: REQ }),
    JSON.stringify({ operation: "resend", orderId: ORDER, clientRequestId: REQ }),
  ]) {
    const h = harness({
      pepperThrows: true,
      rpc: (fn) => ({
        data: fn === "pg_venue_order_rate_limit_hit"
          ? { allowed: true }
          : fn === "biz_comp_cancel"
          ? { orderId: ORDER, status: "cancelled", idempotentReplay: false, emailQueued: false }
          : fn === "biz_door_guest_search"
          ? { orders: [], truncated: false }
          : { orderId: ORDER, queued: true },
        error: null,
      }),
    });
    const res = await h.handler(post(raw));
    assertEquals(res.status, 200, raw);
    assertEquals(h.pepperReads(), 0);
  }
  const h = harness({ pepperThrows: true });
  const res = await h.handler(post(JSON.stringify({ operation: "admit", eventId: EVENT, ticketId: TICKET })));
  assertEquals(res.status, 500);
  assertEquals((await bodyOf(res)).code, "qr_token_pepper_missing");
  assertEquals(h.calls.length, 0, "no rate-limit hit and no admit without a pepper");
});

Deno.test("#3827 adversarial: no dispatch and no audit after a refused RPC", async () => {
  for (const [raw, code, status] of [
    [JSON.stringify({ operation: "resend", orderId: ORDER, clientRequestId: REQ }), "rate_limited", 429],
    [JSON.stringify({ operation: "resend", orderId: ORDER, clientRequestId: REQ }), "no_email", 409],
    [JSON.stringify({ operation: "cancel", orderId: ORDER, reason: null, clientRequestId: REQ }), "comp_already_checked_in", 409],
    [JSON.stringify(issue([{ index: 0, name: "Ana", email: "ana@example.test" }])), "ticket_capacity_exceeded", 409],
    [JSON.stringify(issue([{ index: 0, name: "Ana" }])), "rate_limited", 429],
  ] as Array<[string, string, number]>) {
    const h = harness({ rpc: () => ({ data: null, error: { message: code } }) });
    const res = await h.handler(post(raw));
    assertEquals(res.status, status, `${code}`);
    assertEquals((await bodyOf(res)).code, code);
    assertEquals(h.dispatched.length, 0, `no dispatch after ${code}`);
    assertEquals(h.audits.length, 0, `no audit after ${code}`);
  }
});

Deno.test("#3827 adversarial: a cancel replay neither re-emails nor re-audits; failed/replayed issue rows never dispatch", async () => {
  const h = harness({
    rpc: () => ({ data: { orderId: ORDER, status: "cancelled", idempotentReplay: true, emailQueued: false }, error: null }),
  });
  const res = await h.handler(post(JSON.stringify({ operation: "cancel", orderId: ORDER, reason: null, clientRequestId: REQ })));
  assertEquals(res.status, 200);
  assertEquals(await bodyOf(res), { ok: true, orderId: ORDER, status: "cancelled", idempotentReplay: true });
  assertEquals(h.dispatched.length, 0);
  assertEquals(h.audits.length, 0);

  const h2 = harness({
    dispatchRejects: true,
    auditRejects: true,
    rpc: () => ({
      data: {
        eventDateId: null,
        addedCount: 1,
        failedCount: 2,
        remaining: 0,
        results: [
          { index: 0, plusOneIndex: null, status: "failed", orderId: null, ticketCount: null, emailQueued: true, smsQueued: true, code: "already_on_guest_list" },
          { index: 0, plusOneIndex: 0, status: "failed", orderId: "o-x", ticketCount: null, emailQueued: true, smsQueued: false, code: "lead_not_added" },
          { index: 1, plusOneIndex: null, status: "added", orderId: "o-ok", ticketCount: 1, emailQueued: true, smsQueued: false, code: null },
        ],
      },
      error: null,
    }),
  });
  const res2 = await h2.handler(post(JSON.stringify(issue([{ index: 0, name: "Ana" }, { index: 1, name: "Bo" }]))));
  assertEquals(res2.status, 200, "a rejected dispatch and a rejected audit never fail the issue response");
  assertEquals(h2.dispatched, ["o-ok"], "only the added row is dispatched");
  const body = await bodyOf(res2);
  assertEquals(Object.keys(body).sort(), ["addedCount", "eventDateId", "failedCount", "ok", "remaining", "results"]);
});

Deno.test("#3827 adversarial: the door rate limiter is scoped per actor and blocks before the search or admit RPC", async () => {
  const scopes: string[] = [];
  const h = harness({
    rpc: (fn, args) => {
      if (fn === "pg_venue_order_rate_limit_hit") {
        scopes.push(String(args.p_scope_key));
        return { data: { allowed: false, hits: 61, limit: 60 }, error: null };
      }
      return { data: { orders: [], truncated: false }, error: null };
    },
  });
  const s = await h.handler(post(JSON.stringify({ operation: "search", eventId: EVENT, query: "ana" })));
  const a = await h.handler(post(JSON.stringify({ operation: "admit", eventId: EVENT, ticketId: TICKET })));
  assertEquals([s.status, a.status], [429, 429]);
  assertEquals(h.calls.filter((fn) => fn !== "pg_venue_order_rate_limit_hit"), [], "no search or admit RPC once limited");
  assertEquals(scopes, [`guest_list_search:${ACTOR}`, `guest_list_admit:${ACTOR}`]);
});
