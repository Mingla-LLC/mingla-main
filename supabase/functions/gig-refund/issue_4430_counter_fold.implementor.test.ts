// #4430 P-2 — a part refund that folds in a pending lower-counter difference
// sends the whole quoted amount to Paystack once, and records exactly that
// amount. The SQL quote that adds the difference is proven in
// supabase/migrations/__tests__/issue_4430_gig_money_and_notices.implementor.pg17.test.sql
// (resolved_partial at 40% on fee 15000 with a 5750 difference: 11750).
//
// fails-on-revert: if the handler re-derived the amount from the fee and
// percentage instead of the server quote, Paystack would see 6000.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createGigRefundHandler } from "./handler.ts";

const CONTRACT = "d0976ab9-0000-4000-8000-000000004430";

function world(
  branch: string,
  quote: { refund_minor: number; creator_fee_minor: number },
) {
  const state = {
    claimed: false,
    completed: false,
    provider: [] as Array<
      { transaction: string; amountSubunits: number; currency: string }
    >,
    records: [] as Array<Record<string, unknown>>,
  };
  const rpc = (name: string, args: Record<string, unknown>) => {
    if (name === "gig_refund_claim") {
      if (state.completed) {
        return Promise.resolve({
          data: {
            claimed: false,
            reason: "completed",
            branch,
            provider_ref: "re_1",
          },
          error: null,
        });
      }
      state.claimed = true;
      return Promise.resolve({
        data: { claimed: true, claim_id: "claim-1", attempt: 1 },
        error: null,
      });
    }
    if (name === "gig_refund_claim_finish") {
      state.completed = Boolean(args.p_ok);
      return Promise.resolve({
        data: { status: args.p_ok ? "completed" : "failed", attempts: 1 },
        error: null,
      });
    }
    if (name === "gig_refund_quote") {
      return Promise.resolve({
        data: {
          ...quote,
          currency: "NGN",
          rail: "paystack",
          sources: [{
            kind: "base",
            id: "hold-1",
            provider_ref: "ps_txn_1",
            amount_minor: quote.refund_minor,
          }],
        },
        error: null,
      });
    }
    if (name === "gig_refund_record") {
      state.records.push(args);
      return Promise.resolve({ data: { ok: true }, error: null });
    }
    return Promise.resolve({
      data: null,
      error: { message: `unexpected ${name}` },
    });
  };
  const handler = createGigRefundHandler({
    serviceClient: () => ({ rpc }) as never,
    userClient: () => ({ rpc }) as never,
    isCronCaller: () => Promise.resolve(true),
    stripeRefund: () => Promise.reject(new Error("unused")),
    paystackRefund: (input) => {
      state.provider.push({
        transaction: input.transaction,
        amountSubunits: input.amountSubunits,
        currency: input.currency,
      });
      return Promise.resolve({ id: `re_${state.provider.length}` });
    },
    notifyGaveUp: () => Promise.resolve(0),
  });
  const call = () =>
    handler(
      new Request("https://example.test/functions/v1/gig-refund", {
        method: "POST",
        headers: {
          authorization: "Bearer service",
          "content-type": "application/json",
        },
        body: JSON.stringify({ contract_id: CONTRACT, branch }),
      }),
    );
  return { state, call };
}

Deno.test("#4430 P-2: resolved_partial sends the part refund plus the counter difference once", async () => {
  const w = world("resolved_partial", {
    refund_minor: 11750,
    creator_fee_minor: 9000,
  });
  const response = await w.call();
  assertEquals(response.status, 200);
  assertEquals(w.state.provider, [{
    transaction: "ps_txn_1",
    amountSubunits: 11750,
    currency: "NGN",
  }]);
  assertEquals(w.state.records.length, 1);
  assertEquals(w.state.records[0].p_refund_minor, 11750);
  assertEquals(w.state.records[0].p_creator_fee_minor, 9000);
  // A second timer or webhook call replays and never reaches Paystack again.
  const again = await w.call();
  assertEquals((await again.json()).replayed, true);
  assertEquals(w.state.provider.length, 1);
});

Deno.test("#4430 P-2: the re-opened counter difference is refunded once through counter_lower", async () => {
  const w = world("counter_lower", {
    refund_minor: 5750,
    creator_fee_minor: 0,
  });
  assertEquals((await w.call()).status, 200);
  await w.call();
  assertEquals(w.state.provider, [{
    transaction: "ps_txn_1",
    amountSubunits: 5750,
    currency: "NGN",
  }]);
  assertEquals(w.state.records.length, 1);
});
