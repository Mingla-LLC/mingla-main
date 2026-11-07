// Issue #4271 follow-up (PR #4303) — TESTER ADVERSARIAL suite for what refund-order
// and admin-refund-order do when the Stripe refund arm throws.
//
// Different angle from the implementor suite: it drives the REAL
// executeTicketRefundWithFeeTruth + settleStripeRefundThrow against a fake
// database whose lease, prepare, record and finalize rules mirror the SQL (no
// refunds.status guard, leases that lapse), and a fake Stripe that honours
// idempotency keys, caps refunds at the captured amount, can land a refund and
// still throw, and can prune keys after 24 hours like Stripe does. The invariant
// throughout: one refund row never produces two Stripe refunds, and Stripe
// never makes a refund for a row the database already says 'failed'.
//
// Guards (green):
//   A5  refunds.create returned, then recording it threw -> unknown, pending.
//   A6  refunds.create returned, then a fee read threw a permission error -> unknown.
//   A7  the 'failed' commit erroring or throwing -> unknown, row stays pending.
//   A8  the "ever permitted" lookup fails closed on every error shape.
//   A9  error-classification boundaries (status beats type; no type -> unknown).
//   A10 two concurrent same-key replays while the lease is held -> one create.
// Defects (RED until reworked; see the PR #4303 tester verdict):
//   A1  P0 an admin refund whose reply was lost is resumed by the host path under
//       ticket_refund:<id> instead of admin_refund:<id> -> two Stripe refunds.
//   A2  P1 a row committed 'failed' is retried with the same key once its lease
//       lapses -> Stripe refunds a row the database calls failed, after the
//       freed tickets were refunded again.
//   A3  P1 the classify-then-commit is not atomic: a concurrent request prepares
//       between the "ever permitted" read and the 'failed' commit, then Stripe
//       refunds a failed row.
//   A4  P1 resume relies on Stripe idempotency only: after Stripe prunes the key
//       (24 h) a resumed row whose first refund landed is refunded again.

import { executeTicketRefundWithFeeTruth } from "../../_shared/issue2097TicketRefundTruth.ts";
import {
  isDefinitiveStripeRefundError,
  refundEverPermittedProviderCall,
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
const permissionDenied = () =>
  stripeError("StripePermissionError", { statusCode: 403 });

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
  lease_owner: string | null;
  lease_epoch: number;
  lease_expires_at: number;
};
type RefundRow = {
  status: string;
  stripe_refund_id: string | null;
  quantity: number;
};

// Fake database. prepare / claim / record / finalize follow the #2097 SQL:
// none of them reads refunds.status, leases last 120 s on a fake clock.
function fakeDb(
  opts: { onPrepared?: () => void; recordThrows?: boolean } = {},
) {
  const clock = { now: 0 };
  const refunds = new Map<string, RefundRow>();
  const attempts: Attempt[] = [];
  let seq = 0;
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const rpc = (name: string, args: Record<string, unknown>) => {
    if (
      name === "biz_refund_order_commit" || name === "admin_refund_order_commit"
    ) {
      const row = refunds.get(String(args.p_refund_id));
      if (row && row.status === "pending") row.status = String(args.p_status);
      return ok({ status: row?.status });
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
        provider_call_permitted_at: `t${clock.now}`,
        buyer_refund_id: null,
        baseline_fee_refund_ids: args.p_baseline_fee_refund_ids as string[],
        baseline_amount_refunded_text: String(
          args.p_baseline_amount_refunded_text,
        ),
        fee_refund_amount_text: null,
        lease_owner: String(args.p_lease_owner),
        lease_epoch: 1,
        lease_expires_at: clock.now + 120,
      };
      attempts.push(attempt);
      opts.onPrepared?.();
      return ok({
        attempt_id: attempt.id,
        status: attempt.status,
        provider_call_permitted: true,
        lease_epoch: 1,
        idempotent_replay: false,
      });
    }
    if (name === "issue_2097_claim_refund_attempt") {
      const a = attempts.find((x) => x.id === args.p_attempt_id)!;
      if (
        !["awaiting_application_fee", "pending_visibility"].includes(a.status)
      ) {
        return ok({
          claimed: false,
          status: a.status,
          lease_epoch: a.lease_epoch,
        });
      }
      if (
        a.lease_expires_at > clock.now && a.lease_owner !== args.p_lease_owner
      ) {
        return ok({
          claimed: false,
          status: a.status,
          lease_epoch: a.lease_epoch,
        });
      }
      a.lease_owner = String(args.p_lease_owner);
      a.lease_epoch += 1;
      a.lease_expires_at = clock.now + 120;
      return ok({
        claimed: true,
        status: a.status,
        lease_epoch: a.lease_epoch,
      });
    }
    if (name === "issue_2097_record_buyer_refund") {
      if (opts.recordThrows) {
        return Promise.reject(new Error("connection reset"));
      }
      const a = attempts.find((x) => x.id === args.p_attempt_id)!;
      if (a.buyer_refund_id) {
        return ok({ status: a.status, idempotent_replay: true });
      }
      if (
        a.lease_owner !== args.p_lease_owner || a.lease_expires_at <= clock.now
      ) {
        return Promise.resolve({
          data: null,
          error: { message: "stale_refund_lease" },
        });
      }
      a.buyer_refund_id = String(args.p_buyer_refund_id);
      a.status = "pending_visibility";
      refunds.get(a.refund_id)!.stripe_refund_id = a.buyer_refund_id;
      return ok({ status: "pending_visibility" });
    }
    if (name === "issue_2097_finalize_refund_attempt") {
      const a = attempts.find((x) => x.id === args.p_attempt_id)!;
      a.status = String(args.p_status);
      a.fee_refund_amount_text = args.p_fee_refund_amount_text as string;
      // Like the SQL: succeeded regardless of the row's current status.
      if (args.p_status === "succeeded_positive") {
        refunds.get(a.refund_id)!.status = "succeeded";
      }
      return ok({ status: args.p_status });
    }
    throw new Error(`unexpected rpc ${name}`);
  };
  const from = (table: string) => {
    if (table !== "ticket_refund_attempts") {
      throw new Error(`unexpected table ${table}`);
    }
    const filters: Array<(a: Attempt) => boolean> = [];
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push((a) => (a as Record<string, unknown>)[column] === value);
        return builder;
      },
      not: (column: string) => {
        filters.push((a) => (a as Record<string, unknown>)[column] != null);
        return builder;
      },
      limit: (count: number) =>
        ok(attempts.filter((a) => filters.every((f) => f(a))).slice(0, count)),
      single: () =>
        ok(attempts.find((a) => filters.every((f) => f(a))) ?? null),
    };
    return builder;
  };
  return { clock, refunds, attempts, rpc, from };
}

// Fake Stripe: idempotency keys (prunable), captured-amount cap, lost replies.
function fakeStripe(opts: {
  captured?: number;
  piError?: () => Error | null;
  createError?: (call: number) => Error | null;
  createLandsDespiteError?: (call: number) => boolean;
  feeReadError?: () => Error | null;
  onCreate?: (key: string) => void;
} = {}) {
  const captured = opts.captured ?? 2000;
  const byKey = new Map<string, { id: string; amount: number }>();
  const made: Array<{ id: string; key: string; amount: number }> = [];
  const feeRefunds: Array<
    { id: string; fee: string; amount: number; currency: string }
  > = [];
  const createKeys: string[] = [];
  let calls = 0;
  const stripe = {
    paymentIntents: {
      retrieve: () => {
        const e = opts.piError?.() ?? null;
        if (e) return Promise.reject(e);
        return Promise.resolve({
          latest_charge: {
            id: "ch_1",
            amount_captured: captured,
            livemode: false,
            application_fee: { id: "fee_1" },
          },
        });
      },
    },
    charges: { retrieve: () => Promise.reject(new Error("not used")) },
    applicationFees: {
      retrieve: () => {
        const e = opts.feeReadError?.() ?? null;
        if (e && made.length > 0) return Promise.reject(e);
        return Promise.resolve({
          id: "fee_1",
          amount: 100,
          currency: "gbp",
          charge: "ch_1",
          account: "acct_1",
          livemode: false,
          amount_refunded: feeRefunds.reduce((s, r) => s + r.amount, 0),
        });
      },
      listRefunds: () =>
        Promise.resolve({ data: [...feeRefunds], has_more: false }),
    },
    refunds: {
      create: (
        params: Record<string, unknown>,
        options: Record<string, unknown>,
      ) => {
        calls += 1;
        const key = String(options.idempotencyKey);
        createKeys.push(key);
        opts.onCreate?.(key);
        const amount = Number(params.amount);
        const land = () => {
          if (!byKey.has(key)) {
            const refunded = made.reduce((s, r) => s + r.amount, 0);
            if (refunded + amount > captured) {
              throw stripeError("StripeInvalidRequestError", {
                statusCode: 400,
                code: "charge_already_refunded",
              });
            }
            const row = { id: `re_${made.length + 1}`, key, amount };
            made.push(row);
            byKey.set(key, row);
            feeRefunds.push({
              id: `fr_${feeRefunds.length + 1}`,
              fee: "fee_1",
              amount: 50,
              currency: "gbp",
            });
          }
          return byKey.get(key)!;
        };
        const e = opts.createError?.(calls) ?? null;
        if (e) {
          if (opts.createLandsDespiteError?.(calls)) land();
          return Promise.reject(e);
        }
        try {
          return Promise.resolve(land());
        } catch (err) {
          return Promise.reject(err);
        }
      },
    },
    // Stripe prunes idempotency keys after 24 hours; a reused key then makes a new request.
    pruneKeys: () => byKey.clear(),
  };
  return { stripe, made, createKeys };
}

// The Stripe arm exactly as refund-order (providerKey "ticket_refund") or
// admin-refund-order (providerKey "admin_refund") wires it.
async function runArm(
  db: ReturnType<typeof fakeDb>,
  provider: ReturnType<typeof fakeStripe>,
  input: {
    refundId: string;
    fingerprint: string;
    providerKey: "ticket_refund" | "admin_refund";
    isIdempotentReplay: boolean;
    amount?: number;
    loadPermittedNowHook?: () => Promise<void>;
    beforeCreate?: () => Promise<void>;
  },
) {
  const { refundId } = input;
  const amount = input.amount ?? 2000;
  const permittedBeforeRequest = input.isIdempotentReplay
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
      requestedRefundAmount: amount,
      requestFingerprint: input.fingerprint,
      providerIdempotencyKey: `${input.providerKey}:${refundId}`,
      createBuyerRefund: refundCreate.track(async () => {
        await input.beforeCreate?.();
        return provider.stripe.refunds.create(
          { payment_intent: "pi_1", amount },
          {
            idempotencyKey: `${input.providerKey}:${refundId}`,
            stripeAccount: "acct_1",
          },
        );
      }),
    });
    return { thrown: false, outcome: result.status as string };
  } catch (err) {
    const outcome = await settleStripeRefundThrow({
      error: err,
      tracker: refundCreate,
      permittedBeforeRequest,
      loadPermittedNow: async () => {
        const permitted = await refundEverPermittedProviderCall(db, refundId);
        await input.loadPermittedNowHook?.();
        return permitted;
      },
      commitFailed: () =>
        db.rpc(
          input.providerKey === "admin_refund"
            ? "admin_refund_order_commit"
            : "biz_refund_order_commit",
          {
            p_refund_id: refundId,
            p_stripe_refund_id: null,
            p_application_fee_refunded_cents: 0,
            p_status: "failed",
          },
        ),
      logContext: "tester",
    });
    return { thrown: true, outcome: outcome as string };
  }
}

// ───────────────────────────── Guards ─────────────────────────────

Deno.test("A5 refunds.create returned, then recording it threw: unknown and still pending", async () => {
  const db = fakeDb({ recordThrows: true });
  db.refunds.set("r5", {
    status: "pending",
    stripe_refund_id: null,
    quantity: 2,
  });
  const provider = fakeStripe();
  const out = await runArm(db, provider, {
    refundId: "r5",
    fingerprint: "k5",
    providerKey: "ticket_refund",
    isIdempotentReplay: false,
  });
  assertEquals(
    out,
    { thrown: true, outcome: "unknown" },
    "money moved: never failed",
  );
  assertEquals(db.refunds.get("r5")!.status, "pending", "row stays pending");
  assertEquals(provider.made.length, 1, "one Stripe refund");
});

Deno.test("A6 refunds.create returned, then a fee read threw a permission error: unknown", async () => {
  const db = fakeDb();
  db.refunds.set("r6", {
    status: "pending",
    stripe_refund_id: null,
    quantity: 2,
  });
  const provider = fakeStripe({ feeReadError: permissionDenied });
  const out = await runArm(db, provider, {
    refundId: "r6",
    fingerprint: "k6",
    providerKey: "ticket_refund",
    isIdempotentReplay: false,
  });
  assertEquals(
    out,
    { thrown: true, outcome: "unknown" },
    "a definitive error after create is not failed",
  );
  assertEquals(db.refunds.get("r6")!.status, "pending", "row stays pending");
});

Deno.test("A7 the failed commit erroring or throwing leaves the row pending and reports unknown", async () => {
  for (
    const commitFailed of [
      () =>
        Promise.resolve({
          data: null,
          error: { message: "permission_denied" },
        }),
      () => Promise.reject(new Error("socket hang up")),
    ]
  ) {
    const outcome = await settleStripeRefundThrow({
      error: permissionDenied(),
      tracker: { invoked: false, returned: false },
      permittedBeforeRequest: false,
      loadPermittedNow: () => Promise.resolve(false),
      commitFailed,
      logContext: "tester",
    });
    assertEquals(
      outcome,
      "unknown",
      "a commit that did not land is not reported failed",
    );
  }
});

Deno.test("A8 the ever-permitted lookup fails closed", async () => {
  const shapes = [
    {
      from: () => {
        throw new Error("boom");
      },
    },
    {
      from: () =>
        chain(Promise.resolve({ data: null, error: { message: "timeout" } })),
    },
    { from: () => chain(Promise.resolve({ data: { id: "x" }, error: null })) },
    { from: () => chain(Promise.reject(new Error("network"))) },
  ];
  for (const shape of shapes) {
    assertEquals(
      await refundEverPermittedProviderCall(shape, "r8"),
      true,
      "lookup failure means maybe",
    );
  }
  function chain(result: Promise<unknown>) {
    const b = {
      select: () => b,
      eq: () => b,
      not: () => b,
      limit: () => result,
    };
    return b;
  }
});

Deno.test("A9 classification boundaries: a retryable status always wins over the type", () => {
  const unknown = [
    stripeError("StripePermissionError", { statusCode: 500 }),
    stripeError("StripeCardError", { statusCode: 429 }),
    stripeError("StripeInvalidRequestError", {
      statusCode: 400,
      code: "idempotency_key_in_use",
    }),
    stripeError("StripeAuthenticationError", { statusCode: 409 }),
    Object.assign(new Error("raw"), { rawType: "invalid_request_error" }),
    Object.assign(new Error("odd"), { type: 42 }),
    "StripePermissionError",
    undefined,
  ];
  for (const e of unknown) {
    assertEquals(
      isDefinitiveStripeRefundError(e),
      false,
      `not definitive: ${String((e as { type?: unknown })?.type ?? e)}`,
    );
  }
});

Deno.test("A10 concurrent same-key replays while the lease is held make one Stripe call", async () => {
  const db = fakeDb();
  db.refunds.set("r10", {
    status: "pending",
    stripe_refund_id: null,
    quantity: 2,
  });
  const provider = fakeStripe({
    createError: (n) => n === 1 ? stripeError("StripeConnectionError") : null,
  });
  const first = await runArm(db, provider, {
    refundId: "r10",
    fingerprint: "k10",
    providerKey: "ticket_refund",
    isIdempotentReplay: false,
  });
  assertEquals(first.outcome, "unknown", "connection error is unknown");
  // Two retries inside the 120 s lease: the claim refuses both, nothing reaches Stripe.
  const [a, b] = await Promise.all([
    runArm(db, provider, {
      refundId: "r10",
      fingerprint: "k10",
      providerKey: "ticket_refund",
      isIdempotentReplay: true,
    }),
    runArm(db, provider, {
      refundId: "r10",
      fingerprint: "k10",
      providerKey: "ticket_refund",
      isIdempotentReplay: true,
    }),
  ]);
  assertEquals(
    [a.thrown, b.thrown],
    [false, false],
    "both answered without throwing",
  );
  assertEquals(
    provider.createKeys.length,
    1,
    "only the original create reached Stripe",
  );
});

// ───────────────────────────── Defects ─────────────────────────────

Deno.test("A1 [P0] an admin refund whose reply was lost is never refunded twice by the host resume", async () => {
  const db = fakeDb();
  // Multi-line order: 100.00 VIP + 5 x 20.00; the admin refunds the VIP ticket.
  db.refunds.set("r1", {
    status: "pending",
    stripe_refund_id: null,
    quantity: 1,
  });
  const provider = fakeStripe({
    captured: 20000,
    createError: (n) => n === 1 ? stripeError("StripeConnectionError") : null,
    createLandsDespiteError: (n) => n === 1,
  });
  const admin = await runArm(db, provider, {
    refundId: "r1",
    fingerprint: "admin-key-1",
    providerKey: "admin_refund",
    isIdempotentReplay: false,
    amount: 10000,
  });
  assertEquals(
    admin,
    { thrown: true, outcome: "unknown" },
    "admin arm: unknown, row pending",
  );
  // The webhook adoption missed (lease held). Later the host retries the VIP ticket:
  // biz_refund_order -> line_overrefund -> issue_4271_resumable_refund returns this
  // admin row (pg17 tester D1) and refund-order replays it with ITS key.
  db.clock.now += 600;
  await runArm(db, provider, {
    refundId: "r1",
    fingerprint: "admin-key-1",
    providerKey: "ticket_refund",
    isIdempotentReplay: true,
    amount: 10000,
  });
  assertEquals(
    provider.made.length,
    1,
    `one Stripe refund for refund r1 (keys used: ${
      provider.createKeys.join(", ")
    })`,
  );
});

Deno.test("A2 [P1] a row committed failed never reaches Stripe again", async () => {
  const db = fakeDb();
  db.refunds.set("r2", {
    status: "pending",
    stripe_refund_id: null,
    quantity: 2,
  });
  let createsAfterFailed = 0;
  // 2 of the order's 4 tickets (captured 40.00), so Stripe has room for a second refund.
  const provider = fakeStripe({
    captured: 4000,
    createError: (n) => n === 1 ? permissionDenied() : null,
    onCreate: (key) => {
      if (
        key === "ticket_refund:r2" && db.refunds.get("r2")!.status === "failed"
      ) createsAfterFailed += 1;
    },
  });
  const first = await runArm(db, provider, {
    refundId: "r2",
    fingerprint: "sheet-key-2",
    providerKey: "ticket_refund",
    isIdempotentReplay: false,
  });
  assertEquals(first.outcome, "failed", "definitive error on the first create");
  // The tickets are free: the host refunds them under a new row (new sheet) and it lands.
  db.refunds.set("r2b", {
    status: "pending",
    stripe_refund_id: null,
    quantity: 2,
  });
  const fresh = await runArm(db, provider, {
    refundId: "r2b",
    fingerprint: "sheet-key-3",
    providerKey: "ticket_refund",
    isIdempotentReplay: false,
  });
  assertEquals(
    fresh.outcome,
    "succeeded_positive",
    "the new row refunds the tickets",
  );
  // Two minutes later the first sheet's Send fires again with ITS key: refund-order
  // falls through for a 'failed' row ("If pending or failed: fall through").
  db.clock.now += 180;
  await runArm(db, provider, {
    refundId: "r2",
    fingerprint: "sheet-key-2",
    providerKey: "ticket_refund",
    isIdempotentReplay: true,
  });
  assertEquals(
    { createsAfterFailed, stripeRefunds: provider.made.length },
    { createsAfterFailed: 0, stripeRefunds: 1 },
    "Stripe was asked to refund a row already committed failed (the same two tickets refunded twice)",
  );
});

Deno.test("A3 [P1] a concurrent request cannot prepare between the permitted-read and the failed commit", async () => {
  let markPrepared!: () => void;
  const prepared = new Promise<void>((resolve) => (markPrepared = resolve));
  let markCommitted!: () => void;
  const committed = new Promise<void>((resolve) => (markCommitted = resolve));
  const db = fakeDb({ onPrepared: () => markPrepared() });
  db.refunds.set("r3", {
    status: "pending",
    stripe_refund_id: null,
    quantity: 2,
  });
  let refundsForFailedRow = 0;
  const reading = fakeStripe({
    piError: () => stripeError("StripeAPIError", { statusCode: 500 }),
  });
  const healthy = fakeStripe({
    onCreate: () => {
      if (db.refunds.get("r3")!.status === "failed") refundsForFailedRow += 1;
    },
  });
  // B (first request) fails reading the PaymentIntent; A (same key, double tap)
  // gets through and prepares while B is between its read and its commit.
  const b = runArm(db, reading, {
    refundId: "r3",
    fingerprint: "k3",
    providerKey: "ticket_refund",
    isIdempotentReplay: false,
    loadPermittedNowHook: () => prepared,
  }).then((r) => {
    markCommitted();
    return r;
  });
  const a = runArm(db, healthy, {
    refundId: "r3",
    fingerprint: "k3",
    providerKey: "ticket_refund",
    isIdempotentReplay: true,
    beforeCreate: () => committed,
  });
  const [bOut] = await Promise.all([b, a]);
  if (bOut.outcome === "failed" && healthy.made.length > 0) {
    throw new Error(
      `row committed failed while a concurrent request refunded it at Stripe (refunds for failed row: ${refundsForFailedRow}, final status ${
        db.refunds.get("r3")!.status
      })`,
    );
  }
});

Deno.test("A4 [P1] a resumed row whose first refund landed is not refunded again after Stripe prunes the key", async () => {
  const db = fakeDb();
  db.refunds.set("r4", {
    status: "pending",
    stripe_refund_id: null,
    quantity: 1,
  });
  const provider = fakeStripe({
    captured: 20000,
    createError: (n) => n === 1 ? stripeError("StripeConnectionError") : null,
    createLandsDespiteError: (n) => n === 1,
  });
  const first = await runArm(db, provider, {
    refundId: "r4",
    fingerprint: "k4",
    providerKey: "ticket_refund",
    isIdempotentReplay: false,
    amount: 10000,
  });
  assertEquals(first.outcome, "unknown", "lost reply is unknown");
  // 25 hours later (webhook adoption missed while the lease was held) the host retries;
  // refund-order resumes r4 under its own key, which Stripe has since pruned.
  db.clock.now += 25 * 3600;
  provider.stripe.pruneKeys();
  await runArm(db, provider, {
    refundId: "r4",
    fingerprint: "k4",
    providerKey: "ticket_refund",
    isIdempotentReplay: true,
    amount: 10000,
  });
  assertEquals(provider.made.length, 1, "one Stripe refund for refund r4");
});
