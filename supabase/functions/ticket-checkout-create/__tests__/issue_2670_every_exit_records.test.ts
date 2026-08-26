/**
 * issue #2670 [the refusal log saw 6 of 51 exits] — proof that the exits which
 * were previously SILENT now record, and that the one boundary which must stay
 * silent still does.
 *
 * #2579 made the log record and it covered six exits. The other forty-five
 * returned in silence, including `bookings_closed`, `intake_form_required`,
 * `pricing_config_unavailable` and every payment-rail failure. Read that log and
 * you would conclude the problem was event dates — because event dates was one
 * of the few things it could see. A partial log that reads as complete is worse
 * than no log: it answers confidently and wrongly.
 *
 * The fix shadows `jsonResponse` for the whole handler body rather than adding a
 * recorder to forty-five call sites, so an exit nobody thought about is covered
 * anyway. `event_date_lookup_failed` is the subject here precisely because
 * nobody thought about it: it is an infrastructure failure on the event-dates
 * read, it never went through `refuse()`, and before this change a buyer hitting
 * it left no trace at all.
 *
 * THE DELIBERATE EXCEPTION IS PINNED TOO. The first draft of this fix built the
 * database client lazily so `method_not_allowed` and `invalid_json` would record
 * as well. That broke #1929, whose adversarial test asserts an invalid request
 * dies BEFORE any auth, service or network object exists — a security boundary
 * traded away to log two reasons that are malformed requests rather than buyers
 * being turned away. Those two stay unrecorded on purpose, and the last case
 * below fails if anyone "fixes" that again.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createTicketCheckoutCreateHandler,
  type TicketCheckoutCreateDeps,
} from "../index.ts";

type RpcCall = { name: string; args: Record<string, unknown> };

/** `failOn` makes one table's read return an error, the way infrastructure does. */
const makeDeps = (
  calls: RpcCall[],
  opts: { failOn?: string; onClient?: () => void } = {},
): TicketCheckoutCreateDeps => ({
  userIdFromAuthHeader: () => Promise.resolve(null),
  serviceClient: (() => {
    opts.onClient?.();
    return {
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        // Let the access fence PASS, so the request reaches the event-dates
        // read further down. Without this the run stops at `checkout_restricted`
        // — an exit that already had a recorder, which would make this suite
        // pass against origin/main and prove nothing.
        if (name.includes("access_decision")) {
          return Promise.resolve({ data: "allowed_unrestricted", error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      from: (table: string) => {
        const err = table === opts.failOn
          ? { message: "infrastructure is having a day" }
          : null;
        const chain: Record<string, unknown> = {};
        for (
          const k of ["select", "eq", "in", "gt", "gte", "lt", "order", "limit"]
        ) chain[k] = () => chain;
        chain.maybeSingle = () => Promise.resolve({ data: null, error: err });
        chain.single = () => Promise.resolve({ data: null, error: err });
        chain.then = (res: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], error: err, count: 0 }).then(res);
        return chain;
      },
    };
  }) as never,
  paystackInitializeTransaction: (() => {
    throw new Error("PROVIDER CALLED during a refusal");
  }) as never,
});

const recorded = (calls: RpcCall[]) =>
  calls.filter((c) => c.name === "issue_2579_record_checkout_refusal");

const buyerRequest = (): Request =>
  new Request("https://edge.test/ticket-checkout-create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      eventId: "459a73b3-d303-44fa-806b-4f85038b566f",
      lines: [{
        ticketTypeId: "00000000-0000-0000-0000-000000000000",
        quantity: 2,
      }],
      buyer: {
        name: "Coverage Proof",
        email: "coverage@example.invalid",
        phone: "+2348012345678",
      },
    }),
  });

Deno.test("#2670 an exit that NEVER had a recorder now records", async () => {
  const calls: RpcCall[] = [];
  const handler = createTicketCheckoutCreateHandler(
    makeDeps(calls, { failOn: "event_dates" }),
  );

  const response = await handler(buyerRequest());
  const body = await response.json() as { error?: string };

  assertEquals(
    body.error,
    "event_date_lookup_failed",
    "this case must land on an exit that had no recorder before #2670, or it " +
      "proves nothing about coverage",
  );
  const rows = recorded(calls);
  assertEquals(
    rows.length,
    1,
    "this exit recorded NOTHING before #2670; if this is 0 the shadow is not " +
      "actually a boundary and the log is still a biased sample",
  );
  assertEquals(rows[0].args.p_raise_token, "event_date_lookup_failed");
});

Deno.test("#2670 the recorded reason is the SAME one the buyer was given", async () => {
  const calls: RpcCall[] = [];
  const handler = createTicketCheckoutCreateHandler(
    makeDeps(calls, { failOn: "event_dates" }),
  );

  const response = await handler(buyerRequest());
  const body = await response.json() as { error?: string };

  assertEquals(
    recorded(calls)[0].args.p_raise_token,
    body.error,
    "a log recording a different reason than the buyer was shown cannot be " +
      "cross-checked against a complaint, which is the only reason it exists",
  );
});

Deno.test("#2670 the attempt's details ride along, not just the reason", async () => {
  const calls: RpcCall[] = [];
  const handler = createTicketCheckoutCreateHandler(
    makeDeps(calls, { failOn: "event_dates" }),
  );
  await handler(buyerRequest());

  const args = recorded(calls)[0].args;
  assertEquals(args.p_quantity_requested, 2, "how many they wanted");
  assertEquals(args.p_event_id, "459a73b3-d303-44fa-806b-4f85038b566f");
  assertEquals(
    args.p_buyer_phone_e164,
    "+2348012345678",
    "the RPC stores only the dialling code, but it needs the full number to " +
      "derive it",
  );
});

Deno.test("#2670 a NON-refusal records nothing", async () => {
  // The shadow sees every response. If it recorded 2xx traffic the table would
  // fill with non-events and every refusal count would be meaningless — a
  // louder failure than the silence it replaced.
  const calls: RpcCall[] = [];
  const handler = createTicketCheckoutCreateHandler(makeDeps(calls));

  const response = await handler(
    new Request("https://edge.test/ticket-checkout-create", {
      method: "OPTIONS",
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(recorded(calls).length, 0, "a non-refusal was recorded");
});

Deno.test("#2670 one refused request produces exactly ONE row", async () => {
  // `refuse()` used to record on its own account and the shadow records too. If
  // both fire, every refusal routed through `refuse()` double-counts and the log
  // overstates by 2x on precisely the reasons it already covered.
  const calls: RpcCall[] = [];
  const handler = createTicketCheckoutCreateHandler(makeDeps(calls));

  await handler(buyerRequest());

  assertEquals(
    recorded(calls).length,
    1,
    "a single refusal wrote more than one row — refuse() and the shadow are " +
      "both recording",
  );
});

Deno.test("#2670 an invalid request STILL dies before the client is built", async () => {
  // The #1929 boundary. Recording these two would need a client constructed
  // before the request is known to be valid, which is the exact widening #1929
  // forbids. The first draft of #2670 did this and #1929's adversarial test
  // caught it. Pinned here so the trade is refused on purpose next time.
  const calls: RpcCall[] = [];
  let clientBuilt = false;
  const handler = createTicketCheckoutCreateHandler(
    makeDeps(calls, { onClient: () => void (clientBuilt = true) }),
  );

  const response = await handler(
    new Request("https://edge.test/ticket-checkout-create", { method: "GET" }),
  );

  assertEquals(response.status, 405);
  assert(
    !clientBuilt,
    "a service client was constructed for an invalid request — #1929 forbids " +
      "this, and no amount of log coverage is worth widening it",
  );
  assertEquals(
    recorded(calls).length,
    0,
    "method_not_allowed is deliberately unrecorded; recording it requires the " +
      "widening above",
  );
});
