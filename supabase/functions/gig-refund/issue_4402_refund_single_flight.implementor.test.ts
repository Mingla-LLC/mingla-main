// #4402 F3 / N2 / N3 / N4 — gig-refund is single-flight, behaviourally.
// Two callers race one fake store that implements the gig_refund_claim
// compare-and-set the migration defines (the SQL itself is proven in
// supabase/migrations/__tests__/issue_4402_gig_payment_capture.implementor.pg17.test.sql).
//
// fails-on-revert: deleting the gig_refund_claim call lets both racing
// callers reach the provider (2 refunds); moving the claim after the quote
// leaves a refused quote without backoff (the N2 test sees no failed claim).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createGigRefundHandler, GIG_REFUND_MAX_ATTEMPTS } from "./handler.ts";

const CONTRACT = "6de5eb40-8f30-444e-83b8-d80fa32b3798";

type Claim = {
  id: string;
  status: string;
  attempts: number;
  branch: string;
  provider_ref: string | null;
};

function world(
  opts: {
    quoteFails?: boolean;
    providerFails?: boolean;
    providerDelayMs?: number;
  } = {},
) {
  const state = {
    claim: null as Claim | null,
    providerCalls: 0,
    records: 0,
    alerts: [] as Array<{ attempts: number; error: string }>,
  };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    if (name === "gig_refund_claim") {
      const c = state.claim;
      if (!c) {
        state.claim = {
          id: "claim-1",
          status: "claimed",
          attempts: 1,
          branch: String(args.p_branch),
          provider_ref: null,
        };
        return {
          data: { claimed: true, claim_id: "claim-1", attempt: 1 },
          error: null,
        };
      }
      if (c.status === "failed") {
        c.status = "claimed";
        c.attempts += 1;
        c.branch = String(args.p_branch);
        return {
          data: { claimed: true, claim_id: c.id, attempt: c.attempts },
          error: null,
        };
      }
      const reason = c.status === "completed"
        ? "completed"
        : c.status === "claimed"
        ? "in_flight"
        : c.status;
      return {
        data: {
          claimed: false,
          reason,
          branch: c.branch,
          provider_ref: c.provider_ref,
        },
        error: null,
      };
    }
    if (name === "gig_refund_claim_finish") {
      const c = state.claim!;
      if (args.p_ok) {
        c.status = "completed";
        c.provider_ref = String(args.p_provider_ref);
      } else {c.status = c.attempts >= Number(args.p_max_attempts)
          ? "gave_up"
          : "failed";}
      return { data: { status: c.status, attempts: c.attempts }, error: null };
    }
    if (name === "gig_refund_quote") {
      if (opts.quoteFails) {
        return { data: null, error: { message: "captured_hold_required" } };
      }
      return {
        data: {
          refund_minor: 11500,
          creator_fee_minor: 0,
          currency: "NGN",
          rail: "paystack",
          sources: [{
            kind: "base",
            id: "hold-1",
            provider_ref: "ghold_x_v1",
            amount_minor: 11500,
          }],
        },
        error: null,
      };
    }
    if (name === "gig_refund_record") {
      state.records += 1;
      return { data: { ok: true }, error: null };
    }
    return { data: null, error: { message: `unexpected ${name}` } };
  };
  const handler = createGigRefundHandler({
    serviceClient: () => ({ rpc }) as never,
    userClient: () => ({ rpc }) as never,
    isCronCaller: () => Promise.resolve(true),
    stripeRefund: () => Promise.reject(new Error("unused")),
    paystackRefund: async () => {
      state.providerCalls += 1;
      await new Promise((r) => setTimeout(r, opts.providerDelayMs ?? 0));
      if (opts.providerFails) throw new Error("paystack 502");
      return { id: `re_${state.providerCalls}` };
    },
    notifyGaveUp: (input) => (state.alerts.push(input), Promise.resolve(1)),
  });
  const call = (branch = "payment_late") =>
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

Deno.test("#4402 F3: two racing callers start exactly one provider refund", async () => {
  const w = world({ providerDelayMs: 20 });
  const [a, b] = await Promise.all([
    w.call("payment_late"),
    w.call("payment_late"),
  ]);
  const answers = [await a.json(), await b.json()];
  assertEquals(w.state.providerCalls, 1);
  assertEquals(w.state.records, 1);
  assertEquals(answers.filter((x) => x.ok === true).length, 1);
  assertEquals(
    answers.filter((x) => x.error === "refund_in_progress").length,
    1,
  );
  // Afterwards the same branch replays; a different branch is told the truth (N3).
  assertEquals((await (await w.call("payment_late")).json()).replayed, true);
  const other = await w.call("host_before_accept");
  assertEquals(other.status, 409);
  assertEquals(await other.json(), {
    error: "refund_already_recorded",
    branch: "payment_late",
  });
  assertEquals(w.state.providerCalls, 1);
});

Deno.test("#4402 P3: a failing provider backs off, then gives up and alerts", async () => {
  const w = world({ providerFails: true });
  for (let attempt = 1; attempt <= GIG_REFUND_MAX_ATTEMPTS; attempt += 1) {
    const response = await w.call();
    assertEquals(response.status, 502);
    assertEquals(
      (await response.json()).retry,
      attempt < GIG_REFUND_MAX_ATTEMPTS,
    );
  }
  assertEquals(w.state.claim?.status, "gave_up");
  assertEquals(w.state.alerts.length, 1);
  assertEquals(w.state.alerts[0].attempts, GIG_REFUND_MAX_ATTEMPTS);
});

Deno.test("#4402 N2: a refused quote gets the same backoff and give-up", async () => {
  const w = world({ quoteFails: true });
  const first = await w.call();
  assertEquals(first.status, 409);
  assertEquals((await first.json()).error, "refund_not_ready");
  assertEquals(w.state.claim?.status, "failed");
  assertEquals(w.state.providerCalls, 0);
  for (let attempt = 2; attempt <= GIG_REFUND_MAX_ATTEMPTS; attempt += 1) {
    await w.call();
  }
  assertEquals(w.state.claim?.status, "gave_up");
  assertEquals(w.state.alerts.length, 1);
});
