// Issue #4271 follow-up — a refund whose Stripe call throws no longer stays
// 'pending' forever.
//
// Live case: Stripe answered "Permission denied ... balance_transaction_source_read".
// refund-order logged it and returned 502 while the refunds row stayed 'pending';
// refund_preview then counted it ("line_overrefund: requested=2 existing=2
// capacity=2") and the host could never refund the order again.
//
// These tests drive the REAL executeTicketRefundWithFeeTruth with a fake Stripe
// and a fake database, wired exactly the way refund-order wires them, and pin:
//   S1  a permission error before refunds.create -> the row ends 'failed', and a
//       fresh refund of the same tickets then goes through (one Stripe refund).
//   S2  a permission error thrown BY refunds.create -> 'failed'.
//   S3  a connection error on refunds.create (Stripe may have made it) -> the row
//       stays 'pending'; the retry replays the same row with the same Stripe key
//       and Stripe returns the original refund: exactly one refund exists.
//   S4  a definitive error on a replay whose earlier request reached Stripe ->
//       'unknown' (never failed), because money may already have moved.
//   S5  the error classification table.
//   S6  resumeStuckRefund replays the stuck row under its own key/lines/reason.
//   S7  refund-order and admin-refund-order wire the tracker and the settle step.
//
// FAILS-ON-REVERT: delete the commit in settleStripeRefundThrow (or the catch
// wiring in refund-order/index.ts) and S1/S2/S7 fail; make
// isDefinitiveStripeRefundError treat StripeConnectionError as definitive and S3
// fails.

import { executeTicketRefundWithFeeTruth } from "../../_shared/issue2097TicketRefundTruth.ts";
import {
  classifyStripeRefundThrow,
  isDefinitiveStripeRefundError,
  refundEverPermittedProviderCall,
  resumeStuckRefund,
  settleStripeRefundThrow,
  trackRefundCreate,
} from "../../_shared/ticketRefundStripeThrow.ts";

function assertEquals(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}: expected ${e}, got ${a}`);
}

function stripeError(type: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`${type} injected`), { type, ...extra });
}

// ── Fake database: refunds rows + the #2097 attempt RPCs the helper calls. ──
type Attempt = {
  id: string;
  refund_id: string;
  request_fingerprint: string;
  status: string;
  provider_call_permitted_at: string | null;
  buyer_refund_id: string | null;
  baseline_fee_refund_ids: string[];
  baseline_amount_refunded_text: string;
  fee_refund_amount_text: string | null;
  lease_epoch: number;
};

function fakeDb() {
  const refunds = new Map<string, { status: string; stripe_refund_id: string | null; quantity: number }>();
  const attempts: Attempt[] = [];
  const commits: Array<Record<string, unknown>> = [];
  let seq = 0;
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const rpc = (name: string, args: Record<string, unknown>) => {
    if (name === "biz_refund_order_commit") {
      commits.push(args);
      const row = refunds.get(String(args.p_refund_id));
      if (row && row.status === "pending") row.status = String(args.p_status);
      return ok({ status: args.p_status });
    }
    if (name === "issue_2097_prepare_refund_attempt") {
      const existing = attempts.find((a) =>
        a.refund_id === args.p_refund_id &&
        a.request_fingerprint === args.p_request_fingerprint
      );
      if (existing) {
        return ok({
          attempt_id: existing.id,
          status: existing.status,
          provider_call_permitted: false,
          lease_epoch: existing.lease_epoch,
          idempotent_replay: true,
        });
      }
      const attempt: Attempt = {
        id: `att_${++seq}`,
        refund_id: String(args.p_refund_id),
        request_fingerprint: String(args.p_request_fingerprint),
        status: "awaiting_application_fee",
        provider_call_permitted_at: new Date().toISOString(),
        buyer_refund_id: null,
        baseline_fee_refund_ids: args.p_baseline_fee_refund_ids as string[],
        baseline_amount_refunded_text: String(args.p_baseline_amount_refunded_text),
        fee_refund_amount_text: null,
        lease_epoch: 1,
      };
      attempts.push(attempt);
      return ok({
        attempt_id: attempt.id,
        status: attempt.status,
        provider_call_permitted: true,
        lease_epoch: 1,
        idempotent_replay: false,
      });
    }
    if (name === "issue_2097_claim_refund_attempt") {
      const attempt = attempts.find((a) => a.id === args.p_attempt_id)!;
      attempt.lease_epoch += 1;
      return ok({ claimed: true, status: attempt.status, lease_epoch: attempt.lease_epoch });
    }
    if (name === "issue_2097_record_buyer_refund") {
      const attempt = attempts.find((a) => a.id === args.p_attempt_id)!;
      attempt.buyer_refund_id = String(args.p_buyer_refund_id);
      attempt.status = "pending_visibility";
      refunds.get(attempt.refund_id)!.stripe_refund_id = attempt.buyer_refund_id;
      return ok({ status: "pending_visibility" });
    }
    if (name === "issue_2097_finalize_refund_attempt") {
      const attempt = attempts.find((a) => a.id === args.p_attempt_id)!;
      attempt.status = String(args.p_status);
      attempt.fee_refund_amount_text = args.p_fee_refund_amount_text as string;
      if (args.p_status === "succeeded_positive") {
        refunds.get(attempt.refund_id)!.status = "succeeded";
      }
      return ok({ status: args.p_status });
    }
    throw new Error(`unexpected rpc ${name}`);
  };
  const from = (table: string) => {
    if (table !== "ticket_refund_attempts") throw new Error(`unexpected table ${table}`);
    const filters: Array<(a: Attempt) => boolean> = [];
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push((a) => (a as Record<string, unknown>)[column] === value);
        return builder;
      },
      not: (column: string, _op: string, _value: unknown) => {
        filters.push((a) => (a as Record<string, unknown>)[column] != null);
        return builder;
      },
      limit: (count: number) =>
        ok(attempts.filter((a) => filters.every((f) => f(a))).slice(0, count)),
      single: () => ok(attempts.find((a) => filters.every((f) => f(a))) ?? null),
    };
    return builder;
  };
  // The preview's capacity rule for one 2-ticket line: pending + succeeded count.
  const previewAllows = (quantity: number) => {
    let existing = 0;
    for (const row of refunds.values()) {
      if (row.status === "pending" || row.status === "succeeded") existing += row.quantity;
    }
    return existing + quantity <= 2;
  };
  return { refunds, attempts, commits, rpc, from, previewAllows };
}

// ── Fake Stripe with real idempotency-key semantics on refunds.create. ──
function fakeStripe(opts: {
  piError?: () => Error | null;
  createError?: (call: number) => Error | null;
  // When true, a create that errors still lands at Stripe (the reply was lost).
  createLandsDespiteError?: boolean;
}) {
  const byKey = new Map<string, { id: string; amount: number }>();
  const feeRefunds: Array<{ id: string; fee: string; amount: number; currency: string }> = [];
  const createKeys: string[] = [];
  let calls = 0;
  const fee = () => ({
    id: "fee_1",
    amount: 100,
    currency: "gbp",
    charge: "ch_1",
    account: "acct_1",
    livemode: false,
    amount_refunded: feeRefunds.reduce((sum, row) => sum + row.amount, 0),
  });
  const stripe = {
    paymentIntents: {
      retrieve: () => {
        const error = opts.piError?.() ?? null;
        if (error) return Promise.reject(error);
        return Promise.resolve({
          latest_charge: {
            id: "ch_1",
            amount_captured: 2000,
            livemode: false,
            application_fee: { id: "fee_1" },
          },
        });
      },
    },
    charges: { retrieve: () => Promise.reject(new Error("not used")) },
    applicationFees: {
      retrieve: () => Promise.resolve(fee()),
      listRefunds: () => Promise.resolve({ data: [...feeRefunds], has_more: false }),
    },
    refunds: {
      create: (_params: Record<string, unknown>, options: Record<string, unknown>) => {
        calls += 1;
        const key = String(options.idempotencyKey);
        createKeys.push(key);
        const land = () => {
          if (!byKey.has(key)) {
            byKey.set(key, { id: `re_${byKey.size + 1}`, amount: 2000 });
            feeRefunds.push({ id: `fr_${feeRefunds.length + 1}`, fee: "fee_1", amount: 100, currency: "gbp" });
          }
          return byKey.get(key)!;
        };
        const error = opts.createError?.(calls) ?? null;
        if (error) {
          if (opts.createLandsDespiteError) land();
          return Promise.reject(error);
        }
        return Promise.resolve(land());
      },
    },
  };
  return { stripe, byKey, createKeys };
}

// The refund-order Stripe arm, wired exactly as refund-order/index.ts wires it.
async function runRefundArm(
  db: ReturnType<typeof fakeDb>,
  provider: ReturnType<typeof fakeStripe>,
  refundId: string,
  isIdempotentReplay: boolean,
) {
  const permittedBeforeRequest = isIdempotentReplay
    ? await refundEverPermittedProviderCall(db, refundId)
    : false;
  const refundCreate = trackRefundCreate();
  try {
    const result = await executeTicketRefundWithFeeTruth({
      supabase: db,
      // deno-lint-ignore no-explicit-any
      stripe: provider.stripe as any,
      refundId,
      orderId: "order_1",
      paymentIntentId: "pi_1",
      knownChargeId: null,
      connectedAccountId: "acct_1",
      expectedCurrency: "GBP",
      expectedApplicationFeeAmount: 100,
      requestedRefundAmount: 2000,
      requestFingerprint: `key_${refundId}`,
      createBuyerRefund: refundCreate.track(() =>
        provider.stripe.refunds.create(
          { payment_intent: "pi_1", amount: 2000 },
          { idempotencyKey: `ticket_refund:${refundId}`, stripeAccount: "acct_1" },
        )
      ),
    });
    return { thrown: false, outcome: result.status };
  } catch (err) {
    const outcome = await settleStripeRefundThrow({
      error: err,
      tracker: refundCreate,
      permittedBeforeRequest,
      loadPermittedNow: () => refundEverPermittedProviderCall(db, refundId),
      commitFailed: () =>
        db.rpc("biz_refund_order_commit", {
          p_refund_id: refundId,
          p_stripe_refund_id: null,
          p_application_fee_refunded_cents: 0,
          p_status: "failed",
        }),
      logContext: "test",
    });
    return { thrown: true, outcome };
  }
}

const permissionDenied = () =>
  stripeError("StripePermissionError", {
    statusCode: 403,
    message:
      "Permission denied: does not have the required permissions balance_transaction_source_read",
  });

Deno.test("S1 permission error before refunds.create: row ends failed and a fresh refund then succeeds", async () => {
  const db = fakeDb();
  db.refunds.set("refund_a", { status: "pending", stripe_refund_id: null, quantity: 2 });
  const denied = fakeStripe({ piError: permissionDenied });
  const first = await runRefundArm(db, denied, "refund_a", false);
  assertEquals(first, { thrown: true, outcome: "failed" }, "first attempt outcome");
  assertEquals(db.refunds.get("refund_a")!.status, "failed", "stuck row is committed failed");
  assertEquals(denied.createKeys.length, 0, "Stripe refunds.create was never called");
  assertEquals(db.previewAllows(2), true, "the preview no longer counts the failed row");

  // Permissions fixed: the host's next refund is a new row and goes through once.
  db.refunds.set("refund_b", { status: "pending", stripe_refund_id: null, quantity: 2 });
  const fixed = fakeStripe({});
  const second = await runRefundArm(db, fixed, "refund_b", false);
  assertEquals(second, { thrown: false, outcome: "succeeded_positive" }, "second attempt");
  assertEquals(db.refunds.get("refund_b")!.status, "succeeded", "new row succeeded");
  assertEquals(fixed.byKey.size, 1, "exactly one Stripe refund");
});

Deno.test("S2 permission error thrown by refunds.create itself: row ends failed", async () => {
  const db = fakeDb();
  db.refunds.set("refund_c", { status: "pending", stripe_refund_id: null, quantity: 2 });
  const provider = fakeStripe({ createError: () => permissionDenied() });
  const result = await runRefundArm(db, provider, "refund_c", false);
  assertEquals(result, { thrown: true, outcome: "failed" }, "outcome");
  assertEquals(provider.createKeys, ["ticket_refund:refund_c"], "create was attempted once");
  assertEquals(provider.byKey.size, 0, "Stripe made no refund");
  assertEquals(db.refunds.get("refund_c")!.status, "failed", "row failed");
});

Deno.test("S3 connection error on refunds.create: row stays pending and the retry resumes with the same key, one refund", async () => {
  const db = fakeDb();
  db.refunds.set("refund_d", { status: "pending", stripe_refund_id: null, quantity: 2 });
  const provider = fakeStripe({
    createError: (call) =>
      call === 1 ? stripeError("StripeConnectionError", { statusCode: undefined }) : null,
    createLandsDespiteError: true,
  });
  const first = await runRefundArm(db, provider, "refund_d", false);
  assertEquals(first, { thrown: true, outcome: "unknown" }, "first attempt is unknown");
  assertEquals(db.refunds.get("refund_d")!.status, "pending", "row stays pending");
  assertEquals(db.commits.length, 0, "nothing committed failed");

  // Retry under the same row (biz_refund_order replay -> isIdempotentReplay).
  const retry = await runRefundArm(db, provider, "refund_d", true);
  assertEquals(retry, { thrown: false, outcome: "succeeded_positive" }, "retry resolves");
  assertEquals(
    provider.createKeys,
    ["ticket_refund:refund_d", "ticket_refund:refund_d"],
    "both calls used the row's own Stripe idempotency key",
  );
  assertEquals(provider.byKey.size, 1, "exactly one Stripe refund exists");
  assertEquals(db.refunds.get("refund_d")!.status, "succeeded", "row succeeded");
});

Deno.test("S4 definitive error on a replay whose earlier request reached Stripe stays unknown", async () => {
  const db = fakeDb();
  db.refunds.set("refund_e", { status: "pending", stripe_refund_id: null, quantity: 2 });
  const flaky = fakeStripe({
    createError: () => stripeError("StripeAPIError", { statusCode: 500 }),
  });
  assertEquals(
    (await runRefundArm(db, flaky, "refund_e", false)).outcome,
    "unknown",
    "5xx is unknown",
  );
  const denied = fakeStripe({ createError: () => permissionDenied() });
  const replay = await runRefundArm(db, denied, "refund_e", true);
  assertEquals(replay, { thrown: true, outcome: "unknown" }, "replay never marks failed");
  assertEquals(db.refunds.get("refund_e")!.status, "pending", "row stays pending");

  // A read failure on a replay whose attempts never reached Stripe IS safe to fail.
  db.refunds.set("refund_f", { status: "pending", stripe_refund_id: null, quantity: 2 });
  const readDenied = fakeStripe({ piError: permissionDenied });
  assertEquals(
    await runRefundArm(db, readDenied, "refund_f", true),
    { thrown: true, outcome: "failed" },
    "replay with no permitted attempt fails",
  );
});

Deno.test("S5 Stripe error classification", () => {
  const definitive = [
    stripeError("StripePermissionError", { statusCode: 403 }),
    stripeError("StripeAuthenticationError", { statusCode: 401 }),
    stripeError("StripeCardError", { statusCode: 402 }),
    stripeError("StripeInvalidRequestError", { statusCode: 400, code: "resource_missing" }),
  ];
  const unknown = [
    stripeError("StripeConnectionError"),
    stripeError("StripeAPIError", { statusCode: 500 }),
    stripeError("StripeRateLimitError", { statusCode: 429 }),
    stripeError("StripeIdempotencyError", { statusCode: 400 }),
    stripeError("StripeInvalidRequestError", { statusCode: 409, code: "idempotency_key_in_use" }),
    stripeError("StripeInvalidRequestError", { statusCode: 400, code: "lock_timeout" }),
    new Error("refund_attempt_replay_lookup_failed"),
    null,
  ];
  for (const e of definitive) {
    assertEquals(isDefinitiveStripeRefundError(e), true, `${(e as { type: string }).type} definitive`);
  }
  for (const e of unknown) {
    assertEquals(isDefinitiveStripeRefundError(e), false, `${String((e as { type?: string } | null)?.type)} not definitive`);
  }
  const base = { error: permissionDenied(), permittedBeforeRequest: false, permittedNow: true };
  assertEquals(
    classifyStripeRefundThrow({ ...base, createInvoked: true, createReturned: true }),
    "unknown",
    "a throw after create returned is never failed",
  );
  assertEquals(
    classifyStripeRefundThrow({ ...base, createInvoked: false, createReturned: false }),
    "unknown",
    "a permitted attempt without create in this request is unknown",
  );
});

Deno.test("S6 resumeStuckRefund replays the stuck row under its own key, lines and reason", async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const resumed = await resumeStuckRefund({
    errorMessage: "line_overrefund: line=x requested=2 existing=2 capacity=2",
    orderId: "order_1",
    lines: [{ order_line_item_id: "li_1", quantity: 2 }],
    serviceRpc: (name, args) => {
      calls.push([name, args]);
      return Promise.resolve({
        data: {
          refund_id: "refund_d",
          idempotency_key: "original-key-123",
          reason: "Guest could not attend",
          lines: [{ order_line_item_id: "li_1", quantity: 2, amount_cents: null }],
        },
        error: null,
      });
    },
    replay: (args) => {
      calls.push(["biz_refund_order", args]);
      return Promise.resolve({ data: { refund_id: "refund_d", idempotent_replay: true }, error: null });
    },
  });
  assertEquals(resumed?.idempotencyKey, "original-key-123", "carries the original key");
  assertEquals(calls[0][0], "issue_4271_resumable_refund", "looks up the stuck row");
  assertEquals(calls[1][1], {
    p_order_id: "order_1",
    p_lines: [{ order_line_item_id: "li_1", quantity: 2, amount_cents: null }],
    p_reason: "Guest could not attend",
    p_idempotency_key: "original-key-123",
  }, "replays with the stored request");

  const untouched = await resumeStuckRefund({
    errorMessage: "permission_denied",
    orderId: "order_1",
    lines: [],
    serviceRpc: () => {
      throw new Error("must not look up");
    },
    replay: () => {
      throw new Error("must not replay");
    },
  });
  assertEquals(untouched, null, "other errors stand");
});

Deno.test("S7 refund-order and admin-refund-order settle Stripe throws", async () => {
  const root = new URL("../../", import.meta.url);
  for (const path of ["refund-order/index.ts", "admin-refund-order/index.ts"]) {
    const source = await Deno.readTextFile(new URL(path, root));
    const create = source.indexOf("createBuyerRefund: refundCreate.track(");
    const settle = source.indexOf("await settleStripeRefundThrow(", create);
    const commit = source.indexOf('p_status: "failed"', settle);
    if (create < 0) throw new Error(`${path}: refunds.create is not tracked`);
    if (settle < 0) throw new Error(`${path}: the Stripe catch does not settle the row`);
    if (commit < 0) throw new Error(`${path}: the settle step does not commit 'failed'`);
  }
  const organizer = await Deno.readTextFile(new URL("refund-order/index.ts", root));
  if (!organizer.includes("await resumeStuckRefund(")) {
    throw new Error("refund-order does not resume a stuck pending refund");
  }
  if (!organizer.includes("idempotencyKey = resumed.idempotencyKey;")) {
    throw new Error("refund-order does not carry the stuck row's own key");
  }
});
