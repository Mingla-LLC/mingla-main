// issue #3281 — the door's booked-start reader and response shaping.
// A fake PostgREST chain records every filter, so the event pin is proven.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  bookedStartValue,
  type DoorReadClient,
  readBookedStarts,
  readScanExtras,
  withDoorFields,
} from "../doorBookedStart.ts";

const EVENT = "11111111-1111-4111-8111-111111111111";
const ORDER_A = "44444444-4444-4444-8444-444444444444";
const ORDER_B = "77777777-7777-4777-8777-777777777777";
const OTHER = "88888888-8888-4888-8888-888888888888";

type Recorded = { table?: string; select?: string; eq: [string, unknown][]; in: [string, unknown][]; not: unknown[][]; signal?: AbortSignal };

function fakeClient(result: () => Promise<{ data: unknown; error: unknown }>) {
  const rec: Recorded = { eq: [], in: [], not: [] };
  let queried = 0;
  const chain = {
    select(cols: string) { rec.select = cols; return chain; },
    eq(col: string, v: unknown) { rec.eq.push([col, v]); return chain; },
    in(col: string, v: unknown) { rec.in.push([col, v]); return chain; },
    not(...args: unknown[]) { rec.not.push(args); return chain; },
    abortSignal(signal: AbortSignal) { rec.signal = signal; queried += 1; return result(); },
  };
  const client: DoorReadClient = {
    from: (table: string) => { rec.table = table; return chain; },
    rpc: () => { throw new Error("rpc not expected"); },
  };
  return { client, rec, queried: () => queried };
}

const signal = () => new AbortController().signal;

Deno.test("#3281 booked starts: pinned to the event and to the given orders only", async () => {
  const f = fakeClient(() => Promise.resolve({
    data: [
      { id: ORDER_A, booked_start_at: "2026-11-14T18:30:00+00:00" },
      // a row the query never asked for is never trusted
      { id: OTHER, booked_start_at: "2026-11-14T18:30:00+00:00" },
    ],
    error: null,
  }));
  const out = await readBookedStarts(f.client, EVENT, [ORDER_A, ORDER_A, "not-a-uuid", ORDER_B], signal());
  assertEquals(out, { [ORDER_A]: "2026-11-14T18:30:00+00:00" });
  assertEquals(f.rec.table, "orders");
  assertEquals(f.rec.select, "id, booked_start_at");
  assertEquals(f.rec.eq, [["event_id", EVENT]]);
  assertEquals(f.rec.in, [["id", [ORDER_A, ORDER_B]]]);
  assertEquals(f.rec.not, [["booked_start_at", "is", null]]);
});

Deno.test("#3281 booked starts: no query without a real event or any order", async () => {
  const f = fakeClient(() => Promise.reject(new Error("must not run")));
  assertEquals(await readBookedStarts(f.client, "nope", [ORDER_A], signal()), {});
  assertEquals(await readBookedStarts(f.client, EVENT, [], signal()), {});
  assertEquals(await readBookedStarts(f.client, EVENT, ["x"], signal()), {});
  assertEquals(f.queried(), 0);
});

Deno.test("#3281 booked starts: unreadable values are never passed on", async () => {
  for (const raw of [null, "", "   ", "garbage", 42, {}]) {
    const f = fakeClient(() => Promise.resolve({ data: [{ id: ORDER_A, booked_start_at: raw }], error: null }));
    assertEquals(await readBookedStarts(f.client, EVENT, [ORDER_A], signal()), {}, String(raw));
  }
  assertEquals(bookedStartValue("2026-11-14T18:30:00Z"), "2026-11-14T18:30:00Z");
});

Deno.test("#3281 booked starts: an error, a throw or an abort is just 'nothing', with no database text logged", async () => {
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    for (const result of [
      () => Promise.resolve({ data: null, error: { message: "relation secret_table does not exist" } }),
      () => Promise.reject(new Error("relation secret_table does not exist")),
      () => Promise.reject(new DOMException("aborted", "AbortError")),
      () => Promise.resolve({ data: "not rows", error: null }),
    ]) {
      const f = fakeClient(result);
      assertEquals(await readBookedStarts(f.client, EVENT, [ORDER_A], signal()), {});
    }
  } finally {
    console.error = original;
  }
  assertEquals(logged.length, 4);
  for (const line of logged) assert(!JSON.stringify(line).includes("secret_table"));
});

Deno.test("#3281 scan extras: a failed or thrown read is [] and never throws", async () => {
  const failing: DoorReadClient = {
    from: () => { throw new Error("no"); },
    rpc: () => ({ abortSignal: () => Promise.resolve({ data: null, error: { message: "x" } }) }),
  };
  const throwing: DoorReadClient = {
    from: () => { throw new Error("no"); },
    rpc: () => ({ abortSignal: () => Promise.reject(new Error("boom")) }),
  };
  const original = console.error;
  console.error = () => {};
  try {
    assertEquals(await readScanExtras(failing, "a", EVENT, ORDER_A, signal()), []);
    assertEquals(await readScanExtras(throwing, "a", EVENT, ORDER_A, signal()), []);
  } finally {
    console.error = original;
  }
});

Deno.test("#3281 door fields: nothing to add keeps the scan answer byte-identical", () => {
  const scan = { result: "success", scanId: "s", orderId: ORDER_A, buyerName: "Ada" };
  const same = withDoorFields(scan, [], null);
  assert(same === scan);
  assertEquals(JSON.stringify(same), JSON.stringify(scan));
});

Deno.test("#3281 door fields: each field appears only when it has a value", () => {
  const scan = { result: "success", orderId: ORDER_A };
  const extras = [{ name: "Dinner", quantity: 1 }];
  assertEquals(withDoorFields(scan, extras, null), { ...scan, extras });
  assert(!("bookedStartAt" in withDoorFields(scan, extras, null)));
  assertEquals(withDoorFields(scan, [], "2026-11-14T18:30:00Z"), { ...scan, bookedStartAt: "2026-11-14T18:30:00Z" });
  assert(!("extras" in withDoorFields(scan, [], "2026-11-14T18:30:00Z")));
  assertEquals(
    withDoorFields(scan, extras, "2026-11-14T18:30:00Z"),
    { ...scan, extras, bookedStartAt: "2026-11-14T18:30:00Z" },
  );
});
