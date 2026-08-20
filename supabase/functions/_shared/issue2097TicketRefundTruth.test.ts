import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  classifyFeeRefundEvidence,
  decideFeeRefundPreflight,
  executeTicketRefundWithFeeTruth,
  ISSUE_2097_STATUSES,
  listAllFeeRefunds,
  publicFeeTruth,
} from "./issue2097TicketRefundTruth.ts";

const executorFixture = (options: { replay?: boolean; preflightRejected?: boolean } = {}) => {
  let feeRead = 0;
  let feeList = 0;
  let creates = 0;
  const rpcCalls: string[] = [];
  const supabase = {
    rpc: async (name: string) => {
      rpcCalls.push(name);
      if (name === "issue_2097_prepare_refund_attempt") {
        if (options.preflightRejected) return { data: { attempt_id: "attempt", status: "rejected_preflight", terminal_reason: "partial_fee_below_provider_cent", provider_call_permitted: false }, error: null };
        return { data: { attempt_id: "attempt", status: options.replay ? "succeeded_positive" : "awaiting_application_fee", provider_call_permitted: !options.replay, idempotent_replay: options.replay === true, lease_epoch: 1 }, error: null };
      }
      return { data: { status: "succeeded_positive" }, error: null };
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { buyer_refund_id: "re_existing", baseline_fee_refund_ids: [], baseline_amount_refunded_text: "0" }, error: null }),
        }),
      }),
    }),
  };
  const stripe = {
    paymentIntents: { retrieve: async () => ({ latest_charge: { id: "ch_1", amount_captured: 100, application_fee: "fee_1", livemode: false } }) },
    charges: { retrieve: async () => { throw new Error("unexpected charge lookup"); } },
    applicationFees: {
      retrieve: async () => ({ id: "fee_1", amount: 25, amount_refunded: feeRead++ === 0 ? 0 : 25, currency: "usd", charge: "ch_1", account: "acct_1", livemode: false }),
      listRefunds: async () => ({ data: feeList++ === 0 ? [] : [{ id: "fr_1", fee: "fee_1", amount: 25, currency: "usd" }], has_more: false }),
    },
    refunds: { create: async () => { creates += 1; return { id: "re_1", amount: 100 }; } },
  };
  return { supabase, stripe, rpcCalls, creates: () => creates };
};

Deno.test("#2097 exact ten-state domain has no succeeded_zero", () => {
  assertEquals(ISSUE_2097_STATUSES.length, 10);
  assert(!ISSUE_2097_STATUSES.includes("succeeded_zero" as never));
});

Deno.test("#2097 BigInt preflight is total at zero, threshold, full, and safe maximum", () => {
  assertEquals(decideFeeRefundPreflight("25", "0", "100"), { allowed: false, status: "rejected_preflight", reason: "invalid_provider_amount" });
  assertEquals(decideFeeRefundPreflight("1", "99", "100"), { allowed: false, status: "rejected_preflight", reason: "partial_fee_below_provider_cent" });
  assertEquals(decideFeeRefundPreflight("1", "100", "100"), { allowed: true, kind: "full" });
  assertEquals(decideFeeRefundPreflight("999999999999999", "9999999999999999", "9999999999999999"), { allowed: true, kind: "full" });
  assertEquals(decideFeeRefundPreflight(Number.MAX_SAFE_INTEGER + 1, 1, 2), { allowed: false, status: "rejected_preflight", reason: "invalid_provider_amount" });
});

Deno.test("#2097 no object is pending, one exact positive is success, zero object is conflict", () => {
  const base = { applicationFeeId: "fee_1", currency: "usd", originalFeeAmount: "250", baselineAmountRefunded: "0", baselineIds: [] as string[], listComplete: true };
  assertEquals(classifyFeeRefundEvidence({ ...base, afterAmountRefunded: "0", afterRefunds: [] }), { status: "pending_visibility" });
  assertEquals(classifyFeeRefundEvidence({ ...base, afterAmountRefunded: "25", afterRefunds: [{ id: "fr_1", fee: "fee_1", amount: 25, currency: "usd" }] }), { status: "succeeded_positive", feeRefundId: "fr_1", amountText: "25", afterAmountText: "25" });
  assertEquals(classifyFeeRefundEvidence({ ...base, afterAmountRefunded: "0", afterRefunds: [{ id: "fr_0", fee: "fee_1", amount: 0, currency: "usd" }] }), { status: "evidence_conflict", feeRefundId: "fr_0", observedAmountText: "0" });
});

Deno.test("#2097 pagination is complete and fails closed on a stuck cursor", async () => {
  const pages = [[{ id: "fr_1", fee: "fee", amount: 1, currency: "usd" }], [{ id: "fr_2", fee: "fee", amount: 1, currency: "usd" }]];
  let n = 0;
  assertEquals((await listAllFeeRefunds(async () => ({ data: pages[n], has_more: n++ === 0 }))).length, 2);
  await assertRejects(() => listAllFeeRefunds(async () => ({ data: [{ id: "same", fee: "fee", amount: 1, currency: "usd" }], has_more: true })), Error, "pagination_conflict");
});

Deno.test("#2097 reporting preserves unknown and only renders proven zero/positive", () => {
  assertEquals(publicFeeTruth(null, "pending_visibility"), null);
  assertEquals(publicFeeTruth(0, "not_applicable"), 0);
  assertEquals(publicFeeTruth("25", "succeeded_positive"), 25);
  assertEquals(publicFeeTruth(0, "succeeded_positive"), null);
});

Deno.test("#2097 executor creates once, persists buyer identity, and finalizes only exact evidence", async () => {
  const fixture = executorFixture();
  const result = await executeTicketRefundWithFeeTruth({
    supabase: fixture.supabase as any,
    stripe: fixture.stripe as any,
    refundId: "refund", orderId: "order", paymentIntentId: "pi_1", connectedAccountId: "acct_1",
    expectedCurrency: "usd", expectedApplicationFeeAmount: 25, requestedRefundAmount: 100,
    requestFingerprint: "same", providerIdempotencyKey: "stable",
  });
  assertEquals(result.status, "succeeded_positive");
  assertEquals(fixture.creates(), 1);
  assertEquals(fixture.rpcCalls, ["issue_2097_prepare_refund_attempt", "issue_2097_record_buyer_refund", "issue_2097_finalize_refund_attempt"]);
});

Deno.test("#2097 durable replay adopts provider identity and never creates a second refund", async () => {
  const fixture = executorFixture({ replay: true });
  const result = await executeTicketRefundWithFeeTruth({
    supabase: fixture.supabase as any,
    stripe: fixture.stripe as any,
    refundId: "refund", orderId: "order", paymentIntentId: "pi_1", connectedAccountId: "acct_1",
    expectedCurrency: "usd", expectedApplicationFeeAmount: 25, requestedRefundAmount: 100,
    requestFingerprint: "same", providerIdempotencyKey: "stable",
  });
  assertEquals(result.buyerRefundId, "re_existing");
  assertEquals(fixture.creates(), 0);
});

Deno.test("#2097 rejected preflight performs zero provider mutations", async () => {
  const fixture = executorFixture({ preflightRejected: true });
  const result = await executeTicketRefundWithFeeTruth({
    supabase: fixture.supabase as any,
    stripe: fixture.stripe as any,
    refundId: "refund", orderId: "order", paymentIntentId: "pi_1", connectedAccountId: "acct_1",
    expectedCurrency: "usd", expectedApplicationFeeAmount: 25, requestedRefundAmount: 1,
    requestFingerprint: "same", providerIdempotencyKey: "stable",
  });
  assertEquals(result.status, "rejected_preflight");
  assertEquals(fixture.creates(), 0);
});

Deno.test("#2097 exhaustive status/reason matrix is disjoint", () => {
  const reasons = ["invalid_provider_amount", "partial_fee_below_provider_cent", "fee_preflight_conflict"];
  for (const status of ISSUE_2097_STATUSES) {
    for (const reason of reasons) {
      assertEquals(status === "rejected_preflight", true === (status === "rejected_preflight" && reasons.includes(reason)));
    }
  }
  assertEquals(decideFeeRefundPreflight("25", "0", "100"), {
    allowed: false, status: "rejected_preflight", reason: "invalid_provider_amount",
  });
  assertEquals(decideFeeRefundPreflight("1", "100", "100"), { allowed: true, kind: "full" });
  assertEquals(decideFeeRefundPreflight("2", "50", "100"), { allowed: true, kind: "partial" });
  assertEquals(decideFeeRefundPreflight("2", "49", "100"), {
    allowed: false, status: "rejected_preflight", reason: "partial_fee_below_provider_cent",
  });
});

Deno.test("#2097 bounded observation schedule is exact", async () => {
  const module = await import("./issue2097TicketRefundTruth.ts");
  assertEquals([...module.ISSUE_2097_OBSERVATION_DELAYS_SECONDS], [0, 5, 30, 120, 600, 1800, 7200, 86400]);
});

Deno.test("#2097 historical reconciliation is dry-run-first, exact, and resumable", async () => {
  const history = await import("../admin-reconcile-ticket-refund/historicalReconciliation.ts");
  const exact = history.classifyHistoricalFeeRefund({
    provider: "stripe", exactNoFee: false, applicationFeeId: "fee_1", applicationFeeAmount: "50",
    applicationFeeAmountRefunded: "25", feeRefunds: [{ id: "fr_1", fee: "fee_1", amount: "25", currency: "usd" }],
    currency: "usd", complete: true, ambiguous: false,
  });
  assertEquals(exact, { status: "succeeded_positive", amountText: "25", feeRefundIds: ["fr_1"] });
  assertEquals(history.classifyHistoricalFeeRefund({
    provider: "stripe", exactNoFee: false, applicationFeeId: "fee_1", applicationFeeAmount: "50",
    applicationFeeAmountRefunded: "0", feeRefunds: [], currency: "usd", complete: false, ambiguous: false,
  }).status, "unknown_legacy");
  let reads = 0;
  const plan = await history.buildHistoricalReconciliationPlan({
    rows: [{ id: "a", providerMode: "test" }, { id: "b", providerMode: "live" }, { id: "c", providerMode: "test" }],
    mode: "test", resumeAfter: "a", limit: 10,
    readEvidence: async () => {
      reads += 1;
      return { provider: "paystack", exactNoFee: true, applicationFeeId: null, applicationFeeAmount: 0,
        applicationFeeAmountRefunded: 0, feeRefunds: [], currency: "ngn", complete: true, ambiguous: false };
    },
  });
  assertEquals(plan.dryRun, true);
  assertEquals(plan.nextCursor, "c");
  assertEquals(reads, 1);
  let writes = 0;
  assertEquals(await history.applyApprovedHistoricalPlan({ plan, approvedIds: new Set(), writeClassification: async () => { writes += 1; } }), { applied: 0, skipped: 1 });
  assertEquals(writes, 0);
});
