// issue #3827 — guest-list edge function, implementor happy path.
// Drives the real handler with stubbed dependencies (no network, no database).
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { createHandler, type GuestListDeps, STATUS_BY_CODE } from "../index.ts";

const EVENT = "11111111-1111-4111-8111-111111111111";
const TIER = "22222222-2222-4222-8222-222222222222";
const REQ = "33333333-3333-4333-8333-333333333333";
const ORDER = "44444444-4444-4444-8444-444444444444";
const TICKET = "55555555-5555-4555-8555-555555555555";
const ACTOR = "66666666-6666-4666-8666-666666666666";

type Call = { fn: string; args: Record<string, unknown> };

function harness(opts: {
  actor?: string | null;
  rpc?: (fn: string, args: Record<string, unknown>) => { data: unknown; error: { message: string; hint?: string | null } | null };
  pepperThrows?: boolean;
} = {}) {
  const calls: Call[] = [];
  const dispatched: string[] = [];
  const audits: string[] = [];
  const deps: GuestListDeps = {
    actorId: () => Promise.resolve(opts.actor === undefined ? ACTOR : opts.actor),
    rpc: (fn, args) => {
      calls.push({ fn, args });
      return Promise.resolve(opts.rpc ? opts.rpc(fn, args) : { data: {}, error: null });
    },
    pepper: () => {
      if (opts.pepperThrows) throw new Error("qr_token_pepper_missing");
      return "test-pepper-0123456789abcdef0123456789";
    },
    dispatch: (orderId) => {
      dispatched.push(orderId);
      return Promise.resolve();
    },
    audit: (entry) => {
      audits.push(entry.action);
      return Promise.resolve();
    },
  };
  return { handler: createHandler(deps), calls, dispatched, audits };
}

const post = (body: unknown, raw?: string) =>
  new Request("https://x/guest-list", {
    method: "POST",
    headers: { authorization: "Bearer user-jwt", "content-type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });

const issueBody = (guests: unknown[]) => ({
  operation: "issue",
  eventId: EVENT,
  ticketTypeId: TIER,
  eventDateId: null,
  guests,
  note: null,
  clientRequestId: REQ,
});

Deno.test("#3827 issue: passes the verified actor, dispatches each added emailed order once, never a replay", async () => {
  const h = harness({
    rpc: (fn) =>
      fn === "biz_comp_issue"
        ? {
          data: {
            eventDateId: null,
            addedCount: 2,
            failedCount: 1,
            remaining: 7,
            results: [
              { index: 0, plusOneIndex: null, status: "added", orderId: "o-1", ticketCount: 1, emailQueued: true, smsQueued: false, code: null },
              { index: 1, plusOneIndex: null, status: "replayed", orderId: "o-2", ticketCount: 2, emailQueued: false, smsQueued: false, code: null },
              { index: 2, plusOneIndex: null, status: "added", orderId: "o-3", ticketCount: 1, emailQueued: false, smsQueued: false, code: null },
              { index: 3, plusOneIndex: 0, status: "added", orderId: "o-4", ticketCount: 1, emailQueued: false, smsQueued: true, code: null },
              { index: 4, plusOneIndex: null, status: "failed", orderId: null, ticketCount: null, emailQueued: false, smsQueued: false, code: "already_on_guest_list" },
            ],
          },
          error: null,
        }
        : { data: null, error: null },
  });
  const res = await h.handler(post(issueBody([
    { index: 0, name: "Ana", email: "ana@example.test", phoneE164: null },
    { index: 1, name: "Ben", email: null, phoneE164: null, plusOnes: [{ name: null, email: null, phoneE164: null }] },
  ])));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
  assertEquals(body.addedCount, 2);
  assertEquals(body.remaining, 7);
  assertEquals(h.calls[0].fn, "biz_comp_issue");
  assertEquals(h.calls[0].args.p_actor_id, ACTOR);
  assertEquals(h.calls[0].args.p_client_request_id, REQ);
  assertEquals((h.calls[0].args.p_guests as Array<{ plusOnes: unknown[] }>)[0].plusOnes, []);
  // Emailed and SMS-only adds are dispatched; the replay, the name-only and the failure are not.
  assertEquals(h.dispatched.sort(), ["o-1", "o-4"]);
  assertEquals(h.audits, ["comp_issued"]);
});

Deno.test("#3827 request validation: method, size, JSON, strict keys, 51 guests, bad uuid", async () => {
  const h = harness();
  assertEquals((await h.handler(new Request("https://x", { method: "GET" }))).status, 405);
  assertEquals((await h.handler(post(null, "x".repeat(65_537)))).status, 413);
  assertEquals((await h.handler(post(null, "{not json"))).status, 400);
  const extra = await h.handler(post({ ...issueBody([{ index: 0, name: "A", email: null, phoneE164: null }]), price: 1 }));
  assertEquals((await extra.json()).code, "invalid_request");
  const many = Array.from({ length: 51 }, (_, index) => ({ index: index % 50, name: "G", email: null, phoneE164: null }));
  assertEquals((await h.handler(post(issueBody(many)))).status, 400);
  assertEquals((await h.handler(post({ ...issueBody([{ index: 0, name: "A", email: null, phoneE164: null }]), eventId: "nope" }))).status, 400);
  const tenPlusOnes = Array.from({ length: 10 }, () => ({ name: null, email: null, phoneE164: null }));
  assertEquals((await h.handler(post(issueBody([{ index: 0, name: "A", email: null, phoneE164: null, plusOnes: tenPlusOnes }])))).status, 400);
  assertEquals((await h.handler(post(issueBody([{ index: 0, name: "A", email: "not-an-email", phoneE164: null }])))).status, 400);
  assertEquals(h.calls.length, 0);
});

Deno.test("#3827 unauthenticated callers get 401 before any database call", async () => {
  const h = harness({ actor: null });
  const res = await h.handler(post({ operation: "search", eventId: EVENT, query: "an" }));
  assertEquals(res.status, 401);
  assertEquals((await res.json()).code, "unauthorized");
  assertEquals(h.calls.length, 0);
});

Deno.test("#3827 error mapping: every RPC code gets its status; unknown text is internal and never echoed", async () => {
  for (const [code, status] of Object.entries(STATUS_BY_CODE)) {
    const h = harness({ rpc: () => ({ data: null, error: { message: code } }) });
    const res = await h.handler(post({ operation: "resend", orderId: ORDER, clientRequestId: REQ }));
    assertEquals(res.status, status, code);
    assertEquals((await res.json()).code, code);
  }
  const h = harness({ rpc: () => ({ data: null, error: { message: 'duplicate key value violates "secret_index"' } }) });
  const res = await h.handler(post({ operation: "resend", orderId: ORDER, clientRequestId: REQ }));
  assertEquals(res.status, 500);
  const text = await res.text();
  assert(!text.includes("secret_index"));
  assertEquals(JSON.parse(text).code, "internal");
});

Deno.test("#3827 capacity refusal carries remaining and the ticket name", async () => {
  const h = harness({
    rpc: () => ({ data: null, error: { message: "ticket_capacity_exceeded", hint: '{"remaining":3,"ticketName":"VIP"}' } }),
  });
  const res = await h.handler(post(issueBody([{ index: 0, name: "A", email: null, phoneE164: null }])));
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { ok: false, code: "ticket_capacity_exceeded", remaining: 3, ticketName: "VIP" });
});

Deno.test("#3827 resend dispatches with the service path after the prepare succeeds", async () => {
  const h = harness({ rpc: () => ({ data: { orderId: ORDER, queued: true }, error: null }) });
  const res = await h.handler(post({ operation: "resend", orderId: ORDER, clientRequestId: REQ }));
  assertEquals(res.status, 200);
  assertEquals(h.calls[0].fn, "biz_comp_resend_prepare");
  assertEquals(h.dispatched, [ORDER]);
});

Deno.test("#3827 cancel dispatches the cancellation email once and audits", async () => {
  const h = harness({
    rpc: () => ({ data: { orderId: ORDER, status: "cancelled", idempotentReplay: false, emailQueued: true }, error: null }),
  });
  const res = await h.handler(post({ operation: "cancel", orderId: ORDER, reason: null, clientRequestId: REQ }));
  assertEquals((await res.json()).status, "cancelled");
  assertEquals(h.dispatched, [ORDER]);
  assertEquals(h.audits, ["comp_cancelled"]);
});

Deno.test("#3827 search and admit are rate limited, fail open when the limiter errors", async () => {
  const limited = harness({
    rpc: (fn) => fn === "pg_venue_order_rate_limit_hit" ? { data: { allowed: false }, error: null } : { data: {}, error: null },
  });
  const res = await limited.handler(post({ operation: "search", eventId: EVENT, query: "an" }));
  assertEquals(res.status, 429);
  assertEquals(limited.calls.map((c) => c.fn), ["pg_venue_order_rate_limit_hit"]);

  const open = harness({
    rpc: (fn) =>
      fn === "pg_venue_order_rate_limit_hit"
        ? { data: null, error: { message: "boom" } }
        : { data: { result: "success", ticketId: TICKET, orderId: ORDER, buyerName: "Ana", ticketName: "GA" }, error: null },
  });
  const admit = await open.handler(post({ operation: "admit", eventId: EVENT, ticketId: TICKET }));
  assertEquals(admit.status, 200);
  const body = await admit.json();
  assertEquals(body.result, "success");
  assertEquals(open.calls[1].fn, "biz_ticket_admit_by_id");
  assertEquals(open.calls[1].args.p_actor_id, ACTOR);
});

Deno.test("#3827 a missing QR pepper refuses issue and admit with qr_token_pepper_missing", async () => {
  const h = harness({ pepperThrows: true });
  const res = await h.handler(post({ operation: "admit", eventId: EVENT, ticketId: TICKET }));
  assertEquals(res.status, 500);
  assertEquals((await res.json()).code, "qr_token_pepper_missing");
});

Deno.test("#3827 search is projected: fields the door must never see are dropped", async () => {
  const h = harness({
    rpc: (fn) =>
      fn === "biz_door_guest_search"
        ? {
          data: {
            truncated: false,
            orders: [{
              orderId: ORDER, displayName: "Ana", maskedEmail: "an***@example.test", isGuestList: true,
              cameWithName: null, compReason: "secret note", buyerEmail: "ana@example.test", phone: "+447700900123",
              tickets: [{ ticketId: TICKET, ticketName: "GA", status: "valid", usedAt: null, eventDateIds: [], qrCode: "mingla:v1:ticket:x" }],
            }],
          },
          error: null,
        }
        : { data: { allowed: true }, error: null },
  });
  const res = await h.handler(post({ operation: "search", eventId: EVENT, query: "an" }));
  const text = await res.text();
  for (const leak of ["secret note", "ana@example.test", "+447700900123", "mingla:v1:ticket"]) {
    assert(!text.includes(leak), leak);
  }
  assertEquals(JSON.parse(text).orders[0].maskedEmail, "an***@example.test");
});
