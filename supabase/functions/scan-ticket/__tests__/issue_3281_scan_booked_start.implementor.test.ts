// issue #3281 — scan-ticket carries the guest's booked start to the door.
// Drives the real handler with a stubbed service client (no network).
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { createHandler, type ScanTicketClient } from "../index.ts";

const EVENT = "11111111-1111-4111-8111-111111111111";
const ORDER = "44444444-4444-4444-8444-444444444444";
const OTHER_EVENT_ORDER = "99999999-9999-4999-8999-999999999999";
const ACTOR = "66666666-6666-4666-8666-666666666666";
const BOOKED = "2026-11-14T18:30:00+00:00";

type Settle = (signal?: AbortSignal) => Promise<{ data: unknown; error: unknown }>;

function harness(opts: {
  scan: Record<string, unknown>;
  extras?: Settle;
  /** orders.booked_start_at rows, keyed by (event_id, id) as the table holds them. */
  rows?: { id: string; event_id: string; booked_start_at: string | null }[];
  bookedRead?: Settle;
}) {
  const reads: { eq: [string, unknown][]; in: [string, unknown][] }[] = [];
  const client: ScanTicketClient = {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: ACTOR } }, error: null }) },
    rpc: (fn: string) => {
      if (fn === "biz_ticket_scan") return Promise.resolve({ data: opts.scan, error: null });
      if (fn === "issue_3281_door_order_extras") {
        return { abortSignal: () => (opts.extras ?? (() => Promise.resolve({ data: {}, error: null })))() };
      }
      // #4514 — no form on this event: the door line read finds nothing to show.
      if (fn === "brand_form_door_answers") {
        return { abortSignal: () => Promise.resolve({ data: null, error: null }) };
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
    from: (table: string) => {
      assertEquals(table, "orders");
      const q = { eq: [] as [string, unknown][], in: [] as [string, unknown][] };
      reads.push(q);
      const chain = {
        select: () => chain,
        eq: (c: string, v: unknown) => { q.eq.push([c, v]); return chain; },
        in: (c: string, v: unknown) => { q.in.push([c, v]); return chain; },
        not: () => chain,
        abortSignal: (signal: AbortSignal) => {
          if (opts.bookedRead) return opts.bookedRead(signal);
          const event = q.eq.find(([c]) => c === "event_id")?.[1];
          const ids = (q.in.find(([c]) => c === "id")?.[1] ?? []) as string[];
          const data = (opts.rows ?? []).filter((r) =>
            r.event_id === event && ids.includes(r.id) && r.booked_start_at !== null
          );
          return Promise.resolve({ data, error: null });
        },
      };
      return chain;
    },
  };
  const handler = createHandler({ client: () => client, pepper: () => "pepper", deadlineMs: 50 });
  return { handler, reads };
}

const post = () =>
  new Request("https://x/scan-ticket", {
    method: "POST",
    headers: { authorization: "Bearer jwt", "content-type": "application/json" },
    body: JSON.stringify({ eventId: EVENT, qrPayload: "mingla:v1:ticket:x" }),
  });

const success = { result: "success", scanId: "s1", ticketId: "t1", orderId: ORDER, buyerName: "Ada", ticketName: "Sunset walk" };
const silence = <T>(fn: () => Promise<T>) => {
  const original = console.error;
  console.error = () => {};
  return fn().finally(() => { console.error = original; });
};

Deno.test("#3281 scan: the booked start rides on a successful scan", async () => {
  const h = harness({ scan: success, rows: [{ id: ORDER, event_id: EVENT, booked_start_at: BOOKED }] });
  const body = await (await h.handler(post())).json();
  assertEquals(body, { ...success, bookedStartAt: BOOKED });
  assertEquals(h.reads[0].eq, [["event_id", EVENT]]);
});

Deno.test("#3281 scan: no booked start and no extras keeps the body byte-identical", async () => {
  const h = harness({ scan: success, rows: [] });
  const text = await (await h.handler(post())).text();
  assertEquals(text, JSON.stringify(success));
});

Deno.test("#3281 scan: wrong_event never reveals the other event's booked start", async () => {
  const wrong = { result: "wrong_event", scanId: "s2", orderId: OTHER_EVENT_ORDER, buyerName: null, ticketName: null };
  const h = harness({
    scan: wrong,
    rows: [{ id: OTHER_EVENT_ORDER, event_id: "22222222-2222-4222-8222-222222222222", booked_start_at: BOOKED }],
  });
  const text = await (await h.handler(post())).text();
  assertEquals(text, JSON.stringify(wrong));
  assert(!text.includes("bookedStartAt"));
});

Deno.test("#3281 scan: a stalled booked-start read still returns the extras", async () => {
  const extras = [{ name: "Dinner", quantity: 1, eventDateIds: null }];
  const h = harness({
    scan: success,
    extras: () => Promise.resolve({ data: { [ORDER]: extras }, error: null }),
    // never settles on its own: only the handler's deadline (abort) ends it
    bookedRead: (signal) =>
      new Promise((_, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
  });
  const started = Date.now();
  const body = await silence(async () => await (await h.handler(post())).json());
  assert(Date.now() - started < 1000);
  assertEquals(body, { ...success, extras });
});

Deno.test("#3281 scan: a failed extras read still returns the booked start", async () => {
  const h = harness({
    scan: success,
    extras: () => Promise.resolve({ data: null, error: { message: "boom" } }),
    rows: [{ id: ORDER, event_id: EVENT, booked_start_at: BOOKED }],
  });
  const body = await silence(async () => await (await h.handler(post())).json());
  assertEquals(body, { ...success, bookedStartAt: BOOKED });
});

Deno.test("#3281 scan: a failed booked-start read leaves the scan answer as it was", async () => {
  const h = harness({ scan: success, bookedRead: () => Promise.resolve({ data: null, error: { message: "x" } }) });
  const text = await silence(async () => await (await h.handler(post())).text());
  assertEquals(text, JSON.stringify(success));
});
