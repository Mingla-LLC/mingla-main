// #4514 wave 6 — the ticket scan's door line and "See all answers".
// Drives the real handler with a stubbed service client (no network).
// MINGLA-INVARIANT: I-4514-DOOR-NEVER-CHANGES-ADMISSION | issue #4514 | the door answers read never changes, delays past the door deadline or fails a ticket scan; the full answers open only for a ticket the same person scanned at this event within 30 minutes and the door let in (this suite).
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { createHandler, DOOR_FULL_ANSWERS_WINDOW_MS, type ScanTicketClient } from "../index.ts";

const EVENT = "11111111-1111-4111-8111-111111111111";
const OTHER_EVENT = "22222222-2222-4222-8222-222222222222";
const ORDER = "44444444-4444-4444-8444-444444444444";
const TICKET = "55555555-5555-4555-8555-555555555555";
const SCAN = "77777777-7777-4777-8777-777777777777";
const ACTOR = "66666666-6666-4666-8666-666666666666";
const NOW = Date.parse("2026-11-20T20:00:00Z");

type Settle = (signal?: AbortSignal) => Promise<{ data: unknown; error: unknown }>;
type Call = { fn: string; args: Record<string, unknown> };

const LINE = { state: "answered", formName: "Performers", fullAnswers: true, items: [{ label: "Performing", value: "Yes" }] };
// The door gets the line ready to show (the server owns the 3 / 60 rule).
const SHOWN = { state: "answered", header: null, lines: ["Performing: Yes"], fullAnswers: true };
const UNAVAILABLE = { state: "unavailable", header: null, lines: ["Answers unavailable"], fullAnswers: false };

function harness(opts: {
  scan?: Record<string, unknown>;
  door?: Settle;
  scanRow?: Record<string, unknown> | null;
  full?: () => { data: unknown; error: unknown };
}) {
  const calls: Call[] = [];
  const client: ScanTicketClient = {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: ACTOR } }, error: null }) },
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "biz_ticket_scan") return Promise.resolve({ data: opts.scan, error: null });
      if (fn === "issue_3281_door_order_extras") return { abortSignal: () => Promise.resolve({ data: {}, error: null }) };
      if (fn === "brand_form_door_answers") {
        return { abortSignal: (s: AbortSignal) => (opts.door ?? (() => Promise.resolve({ data: LINE, error: null })))(s) };
      }
      if (fn === "brand_form_door_full_answers") return Promise.resolve(opts.full ? opts.full() : { data: { state: "answered" }, error: null });
      throw new Error(`unexpected rpc ${fn}`);
    },
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        not: () => chain,
        abortSignal: () => Promise.resolve({ data: [], error: null }),
        maybeSingle: () => {
          if (table === "scan_events") return Promise.resolve({ data: opts.scanRow ?? null, error: null });
          if (table === "tickets") return Promise.resolve({ data: { order_id: ORDER }, error: null });
          throw new Error(`unexpected table ${table}`);
        },
      };
      return chain;
    },
  };
  const handler = createHandler({ client: () => client, pepper: () => "pepper", deadlineMs: 50, now: () => NOW });
  return { handler, calls };
}

const post = (body: Record<string, unknown>) =>
  new Request("https://x/scan-ticket", {
    method: "POST",
    headers: { authorization: "Bearer jwt", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const scanBody = { eventId: EVENT, qrPayload: "mingla:v1:ticket:x" };
const success = { result: "success", scanId: SCAN, ticketId: TICKET, orderId: ORDER, buyerName: "Ada", ticketName: "GA" };
const silence = <T>(fn: () => Promise<T>) => {
  const original = console.error;
  console.error = () => {};
  return fn().finally(() => { console.error = original; });
};

Deno.test("#4514 scan: the door line rides on an admitted ticket, read for that ticket at this event", async () => {
  const h = harness({ scan: success });
  const body = await (await h.handler(post(scanBody))).json();
  assertEquals(body, { ...success, doorAnswers: SHOWN });
  const read = h.calls.find((c) => c.fn === "brand_form_door_answers");
  assertEquals(read?.args, { p_actor_id: ACTOR, p_event_id: EVENT, p_subject: { kind: "order", id: ORDER, ticketId: TICKET } });
});

Deno.test("#4514 scan: already scanned repeats the line", async () => {
  const dup = { ...success, result: "duplicate" };
  const body = await (await harness({ scan: dup }).handler(post(scanBody))).json();
  assertEquals(body, { ...dup, doorAnswers: SHOWN });
});

Deno.test("#4514 scan: nothing to show keeps the body byte-identical", async () => {
  const h = harness({ scan: success, door: () => Promise.resolve({ data: null, error: null }) });
  assertEquals(await (await h.handler(post(scanBody))).text(), JSON.stringify(success));
});

Deno.test("#4514 scan: an unanswered form never blocks entry: the result stays success", async () => {
  const notAnswered = { state: "not_answered", formName: "Performers" };
  const h = harness({ scan: success, door: () => Promise.resolve({ data: notAnswered, error: null }) });
  const res = await h.handler(post(scanBody));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.result, "success");
  assertEquals(body.doorAnswers, { state: "not_answered", header: null, lines: ["Questions not answered"], fullAnswers: false });
});

Deno.test("#4514 scan: a failed answers read is 'unavailable' and the scan answer is unchanged", async () => {
  const h = harness({ scan: success, door: () => Promise.resolve({ data: null, error: { message: "boom" } }) });
  const body = await silence(async () => await (await h.handler(post(scanBody))).json());
  assertEquals(body, { ...success, doorAnswers: UNAVAILABLE });
});

Deno.test("#4514 scan: a stalled answers read never slows the scan past the door deadline", async () => {
  const h = harness({
    scan: success,
    door: (signal) =>
      new Promise((_, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
  });
  const started = Date.now();
  const body = await silence(async () => await (await h.handler(post(scanBody))).json());
  assert(Date.now() - started < 1000);
  assertEquals(body, { ...success, doorAnswers: UNAVAILABLE });
});

Deno.test("#4514 scan: refused results never read answers", async () => {
  for (const result of ["wrong_event", "void", "not_found", "not_yet_open", "event_ended"]) {
    const scan = { ...success, result };
    const h = harness({ scan });
    assertEquals(await (await h.handler(post(scanBody))).text(), JSON.stringify(scan));
    assert(!h.calls.some((c) => c.fn === "brand_form_door_answers"), result);
  }
});

const fullBody = { action: "door_full_answers", eventId: EVENT, scanId: SCAN };
const scanRow = { ticket_id: TICKET, event_id: EVENT, scanner_user_id: ACTOR, scan_result: "success", scanned_at: new Date(NOW - 60_000).toISOString() };

Deno.test("#4514 see all answers: the scanned guest at this event, through the checked read", async () => {
  const answered = { state: "answered", formName: "Performers", questions: [] };
  const h = harness({ scanRow, full: () => ({ data: answered, error: null }) });
  const res = await h.handler(post(fullBody));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), answered);
  const read = h.calls.find((c) => c.fn === "brand_form_door_full_answers");
  assertEquals(read?.args, {
    p_actor_id: ACTOR,
    p_event_id: EVENT,
    p_subject: { kind: "order", id: ORDER, ticketId: TICKET },
    p_via: "scan",
  });
  assert(!h.calls.some((c) => c.fn === "biz_ticket_scan"), "opening answers never scans again");
});

Deno.test("#4514 see all answers: a name admit's receipt (same scan_events row) opens it, logged as a search", async () => {
  const h = harness({ scanRow: { ...scanRow, metadata: { source: "manual-admit", via: "name_search" } } });
  const res = await h.handler(post(fullBody));
  assertEquals(res.status, 200);
  assertEquals(h.calls.find((c) => c.fn === "brand_form_door_full_answers")?.args.p_via, "search");
});

Deno.test("#4514 see all answers: a name admit by someone else, or too long ago, is refused", async () => {
  const meta = { metadata: { via: "name_search" } };
  for (const row of [
    { ...scanRow, ...meta, scanner_user_id: "99999999-9999-4999-8999-999999999999" },
    { ...scanRow, ...meta, scanned_at: new Date(NOW - DOOR_FULL_ANSWERS_WINDOW_MS - 1000).toISOString() },
  ]) {
    const h = harness({ scanRow: row });
    assertEquals((await h.handler(post(fullBody))).status, 403);
    assert(!h.calls.some((c) => c.fn === "brand_form_door_full_answers"));
  }
});

Deno.test("#4514 see all answers: only for a scan this person made here, recently, that let the guest in", async () => {
  const refusals: Record<string, unknown>[] = [
    {},
    { scanner_user_id: "99999999-9999-4999-8999-999999999999" },
    { event_id: OTHER_EVENT },
    { scan_result: "void" },
    { scan_result: "wrong_event" },
    { scanned_at: new Date(NOW - DOOR_FULL_ANSWERS_WINDOW_MS - 1).toISOString() },
  ];
  for (const change of refusals) {
    const row = Object.keys(change).length === 0 ? null : { ...scanRow, ...change };
    const h = harness({ scanRow: row });
    const res = await h.handler(post(fullBody));
    assertEquals(res.status, 403, JSON.stringify(change));
    assertEquals(await res.json(), { error: "door_answers_scan_required" });
    assert(!h.calls.some((c) => c.fn === "brand_form_door_full_answers"), JSON.stringify(change));
  }
});

Deno.test("#4514 see all answers: a bad payload is 400 and a refused read is 403", async () => {
  const bad = harness({ scanRow });
  assertEquals((await bad.handler(post({ action: "door_full_answers", eventId: EVENT, scanId: "x" }))).status, 400);
  const refused = harness({ scanRow, full: () => ({ data: null, error: { message: "forbidden" } }) });
  const res = await refused.handler(post(fullBody));
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "door_answers_forbidden" });
});
