// issue #3281 — the door's "Find by name" search names each guest's booked
// start. Drives the real handler with stubbed dependencies.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { createHandler, type GuestListDeps, projectDoorOrders } from "../index.ts";

const EVENT = "11111111-1111-4111-8111-111111111111";
const ORDER_A = "44444444-4444-4444-8444-444444444444";
const ORDER_B = "77777777-7777-4777-8777-777777777777";
const TICKET = "55555555-5555-4555-8555-555555555555";
const ACTOR = "66666666-6666-4666-8666-666666666666";
const BOOKED = "2026-11-14T18:30:00+00:00";

const order = (orderId: string, name: string) => ({
  orderId,
  displayName: name,
  maskedEmail: null,
  isGuestList: false,
  cameWithName: null,
  tickets: [{ ticketId: TICKET, ticketName: "Sunset walk", status: "valid", usedAt: null, eventDateIds: [] }],
});

function harness(bookedStarts?: GuestListDeps["bookedStarts"], extras: Record<string, unknown> = {}) {
  const asked: { eventId: string; orderIds: string[] }[] = [];
  const deps: GuestListDeps = {
    actorId: () => Promise.resolve(ACTOR),
    rpc: (fn) =>
      Promise.resolve(
        fn === "biz_door_guest_search"
          ? { data: { truncated: false, orders: [order(ORDER_A, "Ada"), order(ORDER_B, "Bo")] }, error: null }
          : fn === "issue_3281_door_order_extras"
          ? { data: extras, error: null }
          : fn === "biz_ticket_link_order_labels"
          ? { data: {}, error: null }
          : { data: { allowed: true }, error: null },
      ),
    pepper: () => "pepper",
    dispatch: () => Promise.resolve(),
    audit: () => Promise.resolve(),
    ...(bookedStarts
      ? {
        bookedStarts: (eventId, orderIds, signal) => {
          asked.push({ eventId, orderIds });
          return bookedStarts(eventId, orderIds, signal);
        },
      }
      : {}),
  };
  return { handler: createHandler(deps), asked };
}

const search = () =>
  new Request("https://x/guest-list", {
    method: "POST",
    headers: { authorization: "Bearer jwt", "content-type": "application/json" },
    body: JSON.stringify({ operation: "search", eventId: EVENT, query: "ad" }),
  });

const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
};

Deno.test("#3281 search: each order's booked start, asked only for this event and its own results", async () => {
  const h = harness(() => Promise.resolve({ [ORDER_A]: BOOKED }));
  const body = await (await h.handler(search())).json();
  assertEquals(body.orders[0].bookedStartAt, BOOKED);
  assert(!("bookedStartAt" in body.orders[1]));
  assertEquals(h.asked, [{ eventId: EVENT, orderIds: [ORDER_A, ORDER_B] }]);
});

Deno.test("#3281 search: no reader, a failed reader, or a stalled reader leaves the answer exactly as before", async () => {
  const baseline = await (await harness().handler(search())).text();
  assert(!baseline.includes("bookedStartAt"));
  const rejected = await quiet(async () =>
    await (await harness(() => Promise.reject(new Error("db down"))).handler(search())).text()
  );
  assertEquals(rejected, baseline);
  const started = Date.now();
  const stalled = await quiet(async () =>
    await (await harness((_e, _o, signal) =>
      new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))))
    ).handler(search())).text()
  );
  assertEquals(stalled, baseline);
  assert(Date.now() - started < 2500, "the door search must not wait past its deadline");
});

Deno.test("#3281 search: a stalled booked-start read does not drop extras", async () => {
  const extras = { [ORDER_B]: [{ name: "Dinner", quantity: 2, eventDateIds: null }] };
  const body = await quiet(async () =>
    await (await harness(() => new Promise(() => {}), extras).handler(search())).json()
  );
  assertEquals(body.orders[1].extras, [{ name: "Dinner", quantity: 2, eventDateIds: null }]);
});

Deno.test("#3281 search: a value that is not a readable instant never reaches the door", async () => {
  const body = await (await harness(() =>
    Promise.resolve({ [ORDER_A]: 42 as unknown as string, [ORDER_B]: "not a date" })
  ).handler(search())).json();
  assert(!("bookedStartAt" in body.orders[0]));
  assert(!("bookedStartAt" in body.orders[1]));
});

Deno.test("#3281 projection keeps bookedStartAt only as a readable string", () => {
  const out = projectDoorOrders([
    { ...order(ORDER_A, "Ada"), bookedStartAt: BOOKED },
    { ...order(ORDER_B, "Bo"), bookedStartAt: { iso: BOOKED } },
  ]);
  assertEquals(out[0].bookedStartAt, BOOKED);
  assert(!("bookedStartAt" in out[1]));
});

Deno.test("#3281 search: extras and booked start both stalled cost the door one deadline, not two", async () => {
  const asked: string[] = [];
  const deps: GuestListDeps = {
    actorId: () => Promise.resolve(ACTOR),
    rpc: (fn) => {
      asked.push(fn);
      if (fn === "issue_3281_door_order_extras") return new Promise(() => {});
      return Promise.resolve(
        fn === "biz_door_guest_search"
          ? { data: { truncated: false, orders: [order(ORDER_A, "Ada")] }, error: null }
          : fn === "biz_ticket_link_order_labels"
          ? { data: {}, error: null }
          : { data: { allowed: true }, error: null },
      );
    },
    pepper: () => "pepper",
    dispatch: () => Promise.resolve(),
    audit: () => Promise.resolve(),
    bookedStarts: (_e, _o, signal) =>
      new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))),
    doorDeadlineMs: 200,
  };
  const started = Date.now();
  const res = await quiet(async () => await createHandler(deps)(search()));
  const elapsed = Date.now() - started;
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.orders.length, 1);
  assert(!("bookedStartAt" in body.orders[0]) && !("extras" in body.orders[0]));
  assert(elapsed < 350, `waited ${elapsed} ms for two 200 ms deadlines`);
});
