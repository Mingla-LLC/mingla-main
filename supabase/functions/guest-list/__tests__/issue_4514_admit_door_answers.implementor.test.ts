// #4514 §6 — "Find by name" admit shows the same door line as a ticket scan.
// Drives the real guest-list handler with stubbed dependencies (no network).
// MINGLA-INVARIANT: I-4514-NAME-ADMIT-DOOR-LINE | issue #4514 | the name admit carries the same server-built door line as a ticket scan; the read runs only after the admission is recorded, only for a ticket the door let in, under the door deadline, and a failed or slow read is "unavailable" and never changes or blocks the admit (this suite).
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { createHandler, type GuestListDeps } from "../index.ts";
import { doorAnswersView } from "../../_shared/doorBookedStart.ts";

const EVENT = "11111111-1111-4111-8111-111111111111";
const ORDER = "44444444-4444-4444-8444-444444444444";
const TICKET = "55555555-5555-4555-8555-555555555555";
const ACTOR = "66666666-6666-4666-8666-666666666666";
const SCAN = "77777777-7777-4777-8777-777777777777";

const admitted = {
  result: "success",
  scanId: SCAN,
  ticketId: TICKET,
  orderId: ORDER,
  buyerName: "Ada",
  ticketName: "GA",
  nextStartAt: null,
  lastEndAt: null,
  eventDateId: null,
};
const PLAIN = {
  ok: true,
  result: "success",
  ticketId: TICKET,
  orderId: ORDER,
  buyerName: "Ada",
  ticketName: "GA",
  nextStartAt: null,
  lastEndAt: null,
  eventDateId: null,
};
const SHOWN = doorAnswersView({
  state: "answered",
  fullAnswers: true,
  items: [{ label: "Performing", value: "Yes" }],
});
const UNAVAILABLE = { state: "unavailable", header: null, lines: ["Answers unavailable"], fullAnswers: false };

type Door = GuestListDeps["doorAnswers"];

function harness(opts: { admit?: Record<string, unknown>; door?: Door; admitError?: boolean }) {
  const calls: string[] = [];
  const asked: unknown[][] = [];
  const door = opts.door;
  const deps: GuestListDeps = {
    actorId: () => Promise.resolve(ACTOR),
    rpc: (fn) => {
      calls.push(fn);
      if (fn === "biz_ticket_admit_by_id") {
        return Promise.resolve(
          opts.admitError
            ? { data: null, error: { message: "scanner_not_authorized" } }
            : { data: opts.admit ?? admitted, error: null },
        );
      }
      return Promise.resolve({ data: { allowed: true }, error: null });
    },
    pepper: () => "pepper",
    dispatch: () => Promise.resolve(),
    audit: () => Promise.resolve(),
    doorDeadlineMs: 50,
    ...(door === undefined ? {} : {
      doorAnswers: (...args: Parameters<NonNullable<Door>>) => {
        calls.push("door");
        asked.push(args.slice(0, 4));
        return door(...args);
      },
    }),
  };
  return { handler: createHandler(deps), calls, asked };
}

const admit = () =>
  new Request("https://x/guest-list", {
    method: "POST",
    headers: { authorization: "Bearer jwt", "content-type": "application/json" },
    body: JSON.stringify({ operation: "admit", eventId: EVENT, ticketId: TICKET }),
  });
const silence = <T>(fn: () => Promise<T>) => {
  const original = console.error;
  console.error = () => {};
  return fn().finally(() => { console.error = original; });
};

Deno.test("#4514 name admit: the same door line as a scan, read for that ticket after the admission", async () => {
  const h = harness({ door: () => Promise.resolve(SHOWN) });
  const res = await h.handler(admit());
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ...PLAIN, scanId: SCAN, doorAnswers: SHOWN });
  assertEquals(h.asked, [[ACTOR, EVENT, ORDER, TICKET]]);
  assert(h.calls.indexOf("biz_ticket_admit_by_id") < h.calls.indexOf("door"), "read only after the admit");
});

Deno.test("#4514 name admit: already checked in repeats the line", async () => {
  const h = harness({ admit: { ...admitted, result: "duplicate" }, door: () => Promise.resolve(SHOWN) });
  const body = await (await h.handler(admit())).json();
  assertEquals(body.result, "duplicate");
  assertEquals(body.doorAnswers, SHOWN);
});

Deno.test("#4514 name admit: nothing to show keeps the admit answer as it was", async () => {
  const h = harness({ door: () => Promise.resolve(null) });
  assertEquals(await (await h.handler(admit())).json(), PLAIN);
});

Deno.test("#4514 name admit: refused results never read answers", async () => {
  for (const result of ["wrong_event", "void", "not_found", "not_yet_open", "event_ended"]) {
    const h = harness({ admit: { ...admitted, result }, door: () => Promise.resolve(SHOWN) });
    const body = await (await h.handler(admit())).json();
    assertEquals(body.result, result);
    assertEquals(body.doorAnswers, undefined);
    assert(!h.calls.includes("door"), result);
  }
});

Deno.test("#4514 name admit: a failed read is 'unavailable' and the admit stays success", async () => {
  const h = harness({ door: () => Promise.reject(new Error("boom")) });
  const res = await silence(() => h.handler(admit()));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ...PLAIN, scanId: SCAN, doorAnswers: UNAVAILABLE });
});

Deno.test("#4514 name admit: a stalled read never holds the admit past the door deadline", async () => {
  let aborted = false;
  const h = harness({
    door: (_a, _e, _o, _t, signal) =>
      new Promise(() => {
        signal.addEventListener("abort", () => { aborted = true; });
      }),
  });
  const started = Date.now();
  const res = await silence(() => h.handler(admit()));
  assert(Date.now() - started < 1000);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ...PLAIN, scanId: SCAN, doorAnswers: UNAVAILABLE });
  assert(aborted, "the late read is cancelled");
});

Deno.test("#4514 name admit: a refused admission is unchanged and reads nothing", async () => {
  const h = harness({ admitError: true, door: () => Promise.resolve(SHOWN) });
  const res = await h.handler(admit());
  assertEquals(res.status, 403);
  assert(!h.calls.includes("door"));
});
