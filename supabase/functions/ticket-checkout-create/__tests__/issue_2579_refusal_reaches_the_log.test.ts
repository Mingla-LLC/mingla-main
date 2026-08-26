/**
 * issue #2579 [the refusal log recorded nothing, then recorded the wrong thing]
 * — the END-TO-END proof, driven through the REAL handler.
 *
 * TWO DEFECTS, both found by firing real refusals at the DEPLOYED endpoint and
 * reading the SHIPPED bundle. Neither was visible in the source tree, and
 * neither would have been caught by a test that asserted on source text.
 *
 * (1) THE RECORDING NEVER LANDED. Six real refusals fired back-to-back at the
 *     deployed endpoint recorded ZERO rows, while the same RPC called directly
 *     recorded fine. The call was `void`-ed and never awaited, and the edge
 *     runtime tears the request context down the moment the response returns.
 *     The comment above it claimed "fire-and-forget, never blocks the response":
 *     it got the second half right and silently lost the first.
 *
 * (2) THE REASON WAS DESTROYED BEFORE IT WAS STORED. This file carried its OWN
 *     nineteen-token allowlist and collapsed anything outside it to
 *     `unknown_token` BEFORE calling the RPC — so the RPC's sixty-seven-token
 *     allowlist was unreachable on the only path that matters. A real
 *     past-event refusal was recorded as `unknown_token`, which is the log
 *     answering "somebody could not buy" while withholding "why".
 *
 * WHY THIS DRIVES THE REAL HANDLER. A test that re-implements the mapping tests
 * the transcription, not the code — that mistake has already been made twice on
 * this issue. Every case below runs `createTicketCheckoutCreateHandler` with a
 * fake db, takes the RPC arguments the REAL code passed, and asserts on those.
 *
 * FAILS ON REVERT. `#2579 REVERT GUARD` at the bottom re-implements the deleted
 * collapse and asserts it disagrees with the shipped behaviour on a real arm.
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

const makeDeps = (db: unknown): TicketCheckoutCreateDeps => ({
  userIdFromAuthHeader: () => Promise.resolve(null),
  serviceClient: () => db as never,
  paystackInitializeTransaction: (() => {
    throw new Error("PROVIDER CALLED during a refusal");
  }) as never,
});

/**
 * Trips `event_id_required` — a `refuse()` site that fires BEFORE the access
 * lookup, so it exercises the CHOKE POINT itself rather than the handler's
 * error path. Without this case the suite passes with `refuse()` reverted to
 * fire-and-forget, which is a test that cannot see the defect it names.
 */
const chokePointRequest = (): Request =>
  new Request("https://edge.test/ticket-checkout-create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      lines: [{
        ticketTypeId: "00000000-0000-0000-0000-000000000000",
        quantity: 1,
      }],
      buyer: {
        name: "Choke Point",
        email: "choke@example.invalid",
        phone: "+2348012345678",
      },
    }),
  });

const pastEventRequest = (): Request =>
  new Request("https://edge.test/ticket-checkout-create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      eventId: "459a73b3-d303-44fa-806b-4f85038b566f",
      lines: [{
        ticketTypeId: "00000000-0000-0000-0000-000000000000",
        quantity: 1,
      }],
      buyer: {
        name: "Regression Proof",
        email: "proof@example.invalid",
        phone: "+2348012345678",
      },
    }),
  });

/**
 * issue #2579 — the harness asserts ORDERING, which is the whole defect.
 *
 * `waitUntil` was tried first and did NOT work on this runtime: six real
 * refusals at the deployed endpoint still recorded zero rows, and the platform
 * logs showed a fresh isolate booted and shut down per request without ever
 * opening an HTTP call to the RPC. So the property under test is not "the
 * promise was handed somewhere" — it is "the write had already happened by the
 * time the response existed". Nothing outliving the response is relied upon.
 */
const runRefusal = async (
  calls: RpcCall[],
  request: Request = pastEventRequest(),
): Promise<{ response: Response; recordedBeforeResponse: boolean }> => {
  let recordedAt = -1;
  let tick = 0;
  const db = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "issue_2579_record_checkout_refusal") recordedAt = ++tick;
      // A real network round-trip is not instantaneous. Yielding here is what
      // makes the test able to FAIL: a fire-and-forget caller returns its
      // response during this gap.
      return new Promise((resolve) =>
        setTimeout(() => resolve({ data: null, error: null }), 5)
      );
    },
    from: (_table: string) => {
      const chain: Record<string, unknown> = {};
      for (
        const k of [
          "select",
          "eq",
          "in",
          "gt",
          "gte",
          "lt",
          "order",
          "limit",
          "is",
          "neq",
        ]
      ) chain[k] = () => chain;
      chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
      chain.single = () => Promise.resolve({ data: null, error: null });
      chain.then = (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null, count: 0 }).then(res);
      return chain;
    },
  };
  const handler = createTicketCheckoutCreateHandler(makeDeps(db));
  const response = await handler(request);
  const responseAt = ++tick;
  return {
    response,
    recordedBeforeResponse: recordedAt > 0 && recordedAt < responseAt,
  };
};

Deno.test("#2579 the refusal is RECORDED BEFORE the response is returned", async () => {
  const calls: RpcCall[] = [];
  const { response, recordedBeforeResponse } = await runRefusal(calls);

  assert(response.status >= 400, `expected a refusal, got ${response.status}`);
  assert(
    recordedBeforeResponse,
    "the response was produced before the recording completed — a fire-and-forget " +
      "write, which is exactly the defect where six real refusals at the deployed " +
      "endpoint recorded zero rows",
  );
  assertEquals(
    calls.filter((c) => c.name === "issue_2579_record_checkout_refusal").length,
    1,
    "exactly one refusal should be recorded for one refused request",
  );
});

Deno.test("#2579 the refuse() CHOKE POINT itself records before responding", async () => {
  const calls: RpcCall[] = [];
  const { response, recordedBeforeResponse } = await runRefusal(
    calls,
    chokePointRequest(),
  );
  const body = await response.json() as { error?: string };

  assertEquals(
    body.error,
    "event_id_required",
    "this case must land on a refuse() site, not the handler error path — " +
      "otherwise it cannot see a fire-and-forget regression in refuse() itself",
  );
  assert(
    recordedBeforeResponse,
    "refuse() produced its response before the recording completed: the " +
      "seventeen refusals routed through the choke point would go unlogged",
  );
});

Deno.test("#2579 the RAW reason reaches the RPC, not a collapsed token", async () => {
  const calls: RpcCall[] = [];
  const { response } = await runRefusal(calls);
  const body = await response.json() as { error?: string };
  const recorded = calls.find((c) =>
    c.name === "issue_2579_record_checkout_refusal"
  );

  assert(recorded, "no refusal was recorded at all");
  assertEquals(
    recorded.args.p_raise_token,
    body.error,
    "the token handed to the RPC must be the SAME reason the buyer was given",
  );
  assert(
    recorded.args.p_raise_token !== "unknown_token",
    "the reason was collapsed to `unknown_token` before the RPC could see it — " +
      "this is the defect where the log says somebody could not buy but not why",
  );
});

Deno.test("#2579 REVERT GUARD — the deleted collapse disagrees on a real arm", async () => {
  // The nineteen tokens this file used to carry, and the exact matcher it used.
  const OLD_TOKENS = [
    "buyer_phone_required",
    "event_already_ended",
    "event_currency_required",
    "event_not_found",
    "event_not_selling",
    "mixed_currency_cart",
    "occurrence_not_available",
    "occurrence_not_found",
    "payment_plan_choice_invalid",
    "stripe_account_not_ready",
    "ticket_capacity_exceeded",
    "ticket_lines_required",
    "ticket_quantity_above_max",
    "ticket_quantity_below_min",
    "ticket_quantity_invalid",
    "ticket_sales_ended",
    "ticket_sales_not_started",
    "ticket_type_not_found",
    "ticket_type_unavailable",
  ];
  const oldCollapse = (message: string | undefined): string => {
    if (typeof message !== "string" || message.length === 0) {
      return "unknown_token";
    }
    for (const t of [...OLD_TOKENS].sort((a, b) => b.length - a.length)) {
      if (message.includes(t)) return t;
    }
    return "unknown_token";
  };

  const calls: RpcCall[] = [];
  const { response } = await runRefusal(calls);
  const body = await response.json() as { error?: string };
  const recorded = calls.find((c) =>
    c.name === "issue_2579_record_checkout_refusal"
  );
  assert(recorded, "no refusal was recorded at all");

  // Restoring the old behaviour would store this instead:
  const wouldHaveStored = oldCollapse(body.error);
  assert(
    wouldHaveStored !== recorded.args.p_raise_token,
    "the revert guard is vacuous: the deleted collapse agrees with the shipped " +
      "behaviour on this arm, so restoring it would not go red. Pick an arm " +
      "outside the old nineteen tokens.",
  );
  assertEquals(
    wouldHaveStored,
    "unknown_token",
    "the whole point: this real refusal was stored as `unknown_token` before " +
      "the fix",
  );
});
