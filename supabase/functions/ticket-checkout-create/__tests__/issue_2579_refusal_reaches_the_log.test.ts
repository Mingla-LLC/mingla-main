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

/** Captures RPC traffic and answers the few reads an early refusal performs. */
const makeDb = (calls: RpcCall[]) => {
  const db = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return Promise.resolve({ data: null, error: null });
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
  return db;
};

const makeDeps = (db: unknown): TicketCheckoutCreateDeps => ({
  userIdFromAuthHeader: () => Promise.resolve(null),
  serviceClient: () => db as never,
  paystackInitializeTransaction: (() => {
    throw new Error("PROVIDER CALLED during a refusal");
  }) as never,
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
 * Installs a `waitUntil`-bearing runtime and returns a drain function. This is
 * the shape Supabase's edge runtime provides; without it the recording promise
 * is abandoned when the response returns, which is defect (1).
 */
const withEdgeRuntime = async (
  run: () => Promise<Response>,
): Promise<{ response: Response; drained: number }> => {
  const held: Promise<unknown>[] = [];
  const g = globalThis as { EdgeRuntime?: unknown };
  const prior = g.EdgeRuntime;
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => void held.push(p) };
  try {
    const response = await run();
    await Promise.all(held);
    return { response, drained: held.length };
  } finally {
    if (prior === undefined) delete g.EdgeRuntime;
    else g.EdgeRuntime = prior;
  }
};

Deno.test("#2579 the refusal is HANDED TO THE RUNTIME, not abandoned at response", async () => {
  const calls: RpcCall[] = [];
  const handler = createTicketCheckoutCreateHandler(makeDeps(makeDb(calls)));

  const { response, drained } = await withEdgeRuntime(() =>
    handler(pastEventRequest())
  );

  assert(
    response.status >= 400,
    `expected a refusal, got ${response.status}`,
  );
  assert(
    drained > 0,
    "the recording was never handed to waitUntil — it would be abandoned the " +
      "moment the response returns, which is exactly the zero-rows-from-six-" +
      "real-refusals defect",
  );
  assertEquals(
    calls.filter((c) => c.name === "issue_2579_record_checkout_refusal").length,
    1,
    "exactly one refusal should be recorded for one refused request",
  );
});

Deno.test("#2579 the RAW reason reaches the RPC, not a collapsed token", async () => {
  const calls: RpcCall[] = [];
  const handler = createTicketCheckoutCreateHandler(makeDeps(makeDb(calls)));

  const { response } = await withEdgeRuntime(() =>
    handler(pastEventRequest())
  );
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
  const handler = createTicketCheckoutCreateHandler(makeDeps(makeDb(calls)));
  const { response } = await withEdgeRuntime(() =>
    handler(pastEventRequest())
  );
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
