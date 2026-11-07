// Issue #4271 follow-up (PR #4303) — TESTER ADVERSARIAL suite for what refund-order
// and admin-refund-order do when the Stripe refund arm throws.
//
// Different angle from the implementor suite: it drives the REAL
// executeTicketRefundWithFeeTruth + settleStripeRefundThrow against a fake
// database whose lease, prepare, claim, record, finalize and failed-commit rules
// mirror the SQL (leases that lapse; prepare refuses a refund that is not
// pending; since round 3 claim refuses a non-pending row only for an attempt
// that was never permitted and holds no buyer refund, and record and finalize
// are the unguarded #2097 bodies so money Stripe moved always settles; the failed
// commit re-checks every attempt in one step), and a fake Stripe that honours idempotency keys,
// caps refunds at the captured amount, can land a refund and still throw, and
// can prune keys after 24 hours like Stripe does. The invariant throughout: one
// refund row never produces two Stripe refunds, and Stripe never makes a refund
// for a row the database already says 'failed'.
//
// Guards (green):
//   A5  refunds.create returned, then recording it threw -> unknown, pending.
//   A6  refunds.create returned, then a fee read threw a permission error -> unknown.
//   A7  the 'failed' commit erroring or throwing -> unknown, row stays pending.
//   A8  the "ever permitted" lookup fails closed on every error shape.
//   A9  (rework) ANY error thrown by refunds.create, including the types that
//       used to count as definitive, is unknown and never even tries the commit.
//   A10 two concurrent same-key replays while the lease is held -> one create.
// Former defects, green after the rework:
//   A2  P1 a row committed 'failed' is retried with the same key once its lease
//       lapses -> Stripe must not refund it. A2b: a refusal thrown BY
//       refunds.create stays pending (unknown) and its retry makes one refund.
//       A2c (round 3, re-aligned to the narrowed SQL): a never-permitted attempt
//       on a row that is not pending is never claimed, so the executor's
//       prepare-replay-then-claim path cannot reach Stripe for it.
//       A2d (round 3): money Stripe moved under the key, then another writer
//       failed the row: a same-key replay books that one refund, never a second.
//   A3  P1 a concurrent request prepares between the "ever permitted" read and
//       the 'failed' commit: the atomic commit sees it and answers unknown.
// Removed with the resume feature (the conductor dropped it in the rework):
//   A1  only exercised the host resume of an admin row (issue_4271_resumable_refund).
//   A4  only exercised a resumed row after Stripe pruned its key.

import { executeTicketRefundWithFeeTruth } from "../../_shared/issue2097TicketRefundTruth.ts";
import {
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

// Fake database. prepare / claim / record / finalize follow the #2097 SQL as
// guarded by the PR #4303 round-3 rework (prepare refuses a refund that is not
// pending; claim refuses it only for a never-permitted attempt with no buyer
// refund; record and finalize are unguarded);
// issue_4271_commit_refund_failed follows its SQL; leases last 120 s on a fake clock.
function fakeDb(
  opts: { onPrepared?: () => void; recordThrows?: boolean } = {},
) {
  const clock = { now: 0 };
  const refunds = new Map<string, RefundRow>();
  const attempts: Attempt[] = [];
  let seq = 0;
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const refused = () =>
    Promise.resolve({ data: null, error: { message: "refund_not_pending" } });
  const pending = (refundId: unknown) =>
    refunds.get(String(refundId))?.status === "pending";
  const rpc = (name: string, args: Record<string, unknown>) => {
    if (
      name === "biz_refund_order_commit" || name === "admin_refund_order_commit"
    ) {
      const row = refunds.get(String(args.p_refund_id));
      if (row && row.status === "pending") row.status = String(args.p_status);
      return ok({ status: row?.status });
    }
    if (name === "issue_4271_commit_refund_failed") {
      // One step, like the SQL under the refunds row lock.
      const row = refunds.get(String(args.p_refund_id));
      if (!row) {
        return Promise.resolve({
          data: null,
          error: { message: "refund_not_found" },
        });
      }
      if (row.status === "failed") return ok({ outcome: "failed" });
      if (
        row.status !== "pending" || args.p_provider_call_reached !== false ||
        row.stripe_refund_id
      ) return ok({ outcome: "unknown" });
      const mine = attempts.filter((a) => a.refund_id === args.p_refund_id);
      if (mine.some((a) => a.provider_call_permitted_at || a.buyer_refund_id)) {
        return ok({ outcome: "unknown" });
      }
      for (const a of mine) {
        if (a.status === "awaiting_application_fee") {
          a.status = "application_fee_timeout";
        }
      }
      row.status = "failed";
      return ok({ outcome: "failed" });
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
      if (!pending(args.p_refund_id)) return refused();
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
        !["awaiting_application_fee", "pending_visibility"].includes(
          a.status,
        ) ||
        (!pending(a.refund_id) && !a.provider_call_permitted_at &&
          !a.buyer_refund_id)
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
    // Both refund-order and admin-refund-order now settle through the one
    // atomic SQL commit (PR #4303 rework).
    const outcome = await settleStripeRefundThrow({
      error: err,
      tracker: refundCreate,
      loadPermittedNow: async () => {
        const permitted = await refundEverPermittedProviderCall(db, refundId);
        await input.loadPermittedNowHook?.();
        return permitted;
      },
      commitFailed: (providerCallReached) =>
        db.rpc("issue_4271_commit_refund_failed", {
          p_refund_id: refundId,
          p_provider_call_reached: providerCallReached,
        }),
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

Deno.test("A9 any error thrown by refunds.create is unknown and never tries the commit", async () => {
  const errors = [
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
    // Former "definitive" types: once refunds.create is reached they are unknown.
    stripeError("StripePermissionError", { statusCode: 403 }),
    stripeError("StripeAuthenticationError", { statusCode: 401 }),
    stripeError("StripeCardError", { statusCode: 402 }),
    stripeError("StripeInvalidRequestError", {
      statusCode: 400,
      code: "resource_missing",
    }),
  ];
  for (const e of errors) {
    let commits = 0;
    const outcome = await settleStripeRefundThrow({
      error: e,
      tracker: { invoked: true, returned: false },
      loadPermittedNow: () => Promise.resolve(false),
      commitFailed: () => {
        commits += 1;
        return Promise.resolve({ data: { outcome: "failed" }, error: null });
      },
      logContext: "tester",
    });
    assertEquals(
      { outcome, commits },
      { outcome: "unknown", commits: 0 },
      `thrown by refunds.create: ${
        String((e as { type?: unknown })?.type ?? e)
      }`,
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

Deno.test("A2 [P1] a row committed failed never reaches Stripe again", async () => {
  const db = fakeDb();
  db.refunds.set("r2", {
    status: "pending",
    stripe_refund_id: null,
    quantity: 2,
  });
  let createsAfterFailed = 0;
  // 2 of the order's 4 tickets (captured 40.00), so Stripe has room for a second refund.
  // Rework: 'failed' now needs Stripe to have never been reached, so the first
  // refusal is the live one (reading the payment), not refunds.create (see A2b).
  let piCalls = 0;
  const provider = fakeStripe({
    captured: 4000,
    piError: () => (++piCalls === 1 ? permissionDenied() : null),
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
  assertEquals(
    first.outcome,
    "failed",
    "definitive error before Stripe was reached",
  );
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
  // Two minutes later the first sheet's Send fires again with ITS key.
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

Deno.test("A2b [P1] a refusal thrown by refunds.create stays pending and its retry makes one refund", async () => {
  const db = fakeDb();
  db.refunds.set("r2c", {
    status: "pending",
    stripe_refund_id: null,
    quantity: 2,
  });
  const provider = fakeStripe({
    captured: 4000,
    createError: (n) => n === 1 ? permissionDenied() : null,
  });
  const first = await runArm(db, provider, {
    refundId: "r2c",
    fingerprint: "sheet-key-4",
    providerKey: "ticket_refund",
    isIdempotentReplay: false,
  });
  assertEquals(
    first,
    { thrown: true, outcome: "unknown" },
    "refunds.create reached: unknown",
  );
  assertEquals(
    db.refunds.get("r2c")!.status,
    "pending",
    "the row keeps its tickets",
  );
  db.clock.now += 180;
  await runArm(db, provider, {
    refundId: "r2c",
    fingerprint: "sheet-key-4",
    providerKey: "ticket_refund",
    isIdempotentReplay: true,
  });
  assertEquals(provider.made.length, 1, "exactly one Stripe refund");
  assertEquals(
    provider.createKeys,
    ["ticket_refund:r2c", "ticket_refund:r2c"],
    "one key throughout",
  );
});

Deno.test("A2c [P1] a never-permitted attempt on a row that is not pending is never claimed", async () => {
  const db = fakeDb();
  // The fee was not visible yet: record_pre_refund_state left an open attempt
  // that was never permitted to call Stripe. Then the row left 'pending'
  // (another writer failed it, or our commit failed it and the attempt was
  // reopened). The fee is visible now and the same key replays.
  db.refunds.set("r2d", {
    status: "failed",
    stripe_refund_id: null,
    quantity: 2,
  });
  db.attempts.push({
    id: "att_pre",
    refund_id: "r2d",
    request_fingerprint: "sheet-key-5",
    status: "awaiting_application_fee",
    provider_call_permitted_at: null,
    buyer_refund_id: null,
    baseline_fee_refund_ids: [],
    baseline_amount_refunded_text: "0",
    fee_refund_amount_text: null,
    lease_owner: null,
    lease_epoch: 0,
    lease_expires_at: 0,
  });
  const provider = fakeStripe({ captured: 4000 });
  await runArm(db, provider, {
    refundId: "r2d",
    fingerprint: "sheet-key-5",
    providerKey: "ticket_refund",
    isIdempotentReplay: true,
  });
  assertEquals(provider.createKeys.length, 0, "Stripe is never asked");
  assertEquals(provider.made.length, 0, "no Stripe refund for the failed row");
  assertEquals(db.refunds.get("r2d")!.status, "failed", "the row stays failed");
});

Deno.test("A2d [P0] money Stripe moved under the key still books after another writer failed the row, exactly once", async () => {
  const db = fakeDb();
  db.refunds.set("r2e", {
    status: "pending",
    stripe_refund_id: null,
    quantity: 2,
  });
  // refunds.create lands at Stripe but the reply is lost: unknown, row pending.
  const provider = fakeStripe({
    createError: (n) => n === 1 ? stripeError("StripeConnectionError") : null,
    createLandsDespiteError: (n) => n === 1,
  });
  const first = await runArm(db, provider, {
    refundId: "r2e",
    fingerprint: "trip-key-1",
    providerKey: "ticket_refund",
    isIdempotentReplay: false,
  });
  assertEquals(first.outcome, "unknown", "a lost reply is unknown");
  // Another writer (cancel-trip-booking's rollback) marks the row failed.
  await db.rpc("biz_refund_order_commit", {
    p_refund_id: "r2e",
    p_stripe_refund_id: null,
    p_application_fee_refunded_cents: 0,
    p_status: "failed",
  });
  db.clock.now += 180;
  await runArm(db, provider, {
    refundId: "r2e",
    fingerprint: "trip-key-1",
    providerKey: "ticket_refund",
    isIdempotentReplay: true,
  });
  assertEquals(provider.made.length, 1, "exactly one Stripe refund");
  assertEquals(
    db.attempts.find((a) => a.refund_id === "r2e")!.buyer_refund_id,
    "re_1",
    "the refund Stripe made is booked on the attempt",
  );
  assertEquals(
    db.refunds.get("r2e")!.stripe_refund_id,
    "re_1",
    "the refund row records the Stripe refund",
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
