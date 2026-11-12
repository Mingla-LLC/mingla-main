// #4402 — the Stripe backstop for creator-hire payments: a gig PaymentIntent
// that succeeded is recorded by stripe-webhook even if the Host app was
// killed between the card sheet and its confirm call.
//
// fails-on-revert: deleting the isGigStripeEvent branch in routeStripeEvent
// sends a gig PaymentIntent to the ticket checkout handler; the store spy is
// never called and the capture assertions fail.
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isGigStripeEvent, routeStripeEvent } from "../stripeWebhookRouter.ts";
import type {
  GigCaptureStore,
  GigMismatchAlertInput,
} from "../gigPaymentCapture.ts";

const CONTRACT = "6de5eb40-8f30-444e-83b8-d80fa32b3798";

function fakeDb(audits: string[]) {
  const chain: Record<string, unknown> = new Proxy({}, {
    get(_target, prop) {
      if (prop === "maybeSingle" || prop === "single") {
        return () => Promise.resolve({ data: null, error: null });
      }
      if (prop === "then") {
        return (resolve: (value: unknown) => void) =>
          resolve({ data: [], error: null });
      }
      return () => chain;
    },
  });
  return {
    from(table: string) {
      if (table === "audit_log") {
        return {
          insert(row: Record<string, unknown>) {
            audits.push(String(row.action));
            return Promise.resolve({ error: null });
          },
        };
      }
      return chain;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
}

function store(
  amount = 11500,
  fail?: Error,
): GigCaptureStore & { marks: string[] } {
  const marks: string[] = [];
  return {
    marks,
    loadLedger: () =>
      fail ? Promise.reject(fail) : Promise.resolve({
        amountMinor: amount,
        currency: "USD",
        rail: "stripe",
        status: "pending",
        providerRef: "pi_gig_1",
      }),
    markCaptured: (kind, contractId, termsVersion, ref) => {
      marks.push(`${kind}:${contractId}:${termsVersion}:${ref}`);
      return Promise.resolve({ replayed: false, lateCapture: false });
    },
  };
}

const event = (type: string, over: Record<string, unknown> = {}) => ({
  id: "evt_gig_1",
  type,
  account: null,
  data: {
    object: {
      id: "pi_gig_1",
      object: "payment_intent",
      status: type === "payment_intent.succeeded"
        ? "succeeded"
        : "requires_payment_method",
      amount: 11500,
      currency: "usd",
      metadata: {
        mingla_kind: "gig_hold",
        contract_id: CONTRACT,
        terms_version: "1",
      },
      ...over,
    },
  },
});

Deno.test("#4402 a gig PaymentIntent is recognised by its metadata only", () => {
  assertEquals(isGigStripeEvent(event("payment_intent.succeeded")), true);
  assertEquals(
    isGigStripeEvent(
      event("payment_intent.succeeded", {
        metadata: { mingla_kind: "ticket" },
      }),
    ),
    false,
  );
});

Deno.test("#4402 payment_intent.succeeded for a gig is captured by the webhook", async () => {
  const audits: string[] = [];
  const s = store();
  const result = await routeStripeEvent(
    fakeDb(audits) as never,
    {} as never,
    event("payment_intent.succeeded"),
    { store: s },
  );
  assertEquals(s.marks, [`gig_hold:${CONTRACT}:1:pi_gig_1`]);
  assertEquals(audits, ["gig.payment_captured"]);
  assertEquals(result.gigMismatchReason, undefined);
});

Deno.test("#4402 a gig intent that does not match the hold is flagged and alerted", async () => {
  const alerts: GigMismatchAlertInput[] = [];
  const s = store(5000);
  const result = await routeStripeEvent(
    fakeDb([]) as never,
    {} as never,
    event("payment_intent.succeeded"),
    {
      store: s,
      notifyMismatch: (input) => (alerts.push(input), Promise.resolve(1)),
    },
  );
  assertEquals(result.gigMismatchReason, "amount_mismatch");
  assertEquals(s.marks.length, 0);
  assertEquals(alerts.map((a) => [a.rail, a.reason]), [[
    "stripe",
    "amount_mismatch",
  ]]);
});

Deno.test("#4402 a failed gig intent is a no-op with an audit row", async () => {
  const audits: string[] = [];
  const s = store();
  await routeStripeEvent(
    fakeDb(audits) as never,
    {} as never,
    event("payment_intent.payment_failed"),
    { store: s },
  );
  assertEquals(s.marks.length, 0);
  assertEquals(audits, ["gig.payment_not_completed"]);
});

Deno.test("#4402 a transient ledger error asks Stripe to redeliver", async () => {
  const err = await assertRejects(() =>
    routeStripeEvent(
      fakeDb([]) as never,
      {} as never,
      event("payment_intent.succeeded"),
      {
        store: store(11500, new Error("connection reset")),
      },
    )
  );
  assertEquals((err as Error).name, "StripeWebhookRetryableError");
});

Deno.test("#4402 P3: a connected account's event is never treated as a gig payment", () => {
  assertEquals(
    isGigStripeEvent({
      ...event("payment_intent.succeeded"),
      account: "acct_123",
    }),
    false,
  );
});
