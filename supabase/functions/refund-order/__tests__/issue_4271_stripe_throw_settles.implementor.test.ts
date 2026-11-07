// Issue #4271 follow-up — a refund whose Stripe call throws no longer stays
// 'pending' forever, and a refund committed 'failed' never reaches Stripe again.
//
// Live case: Stripe answered "Permission denied ... balance_transaction_source_read".
// refund-order logged it and returned 502 while the refunds row stayed 'pending';
// refund_preview then counted it ("line_overrefund: requested=2 existing=2
// capacity=2") and the host could never refund the order again.
//
// PR #4303 rework (tester FAIL): the resume feature is gone. A refund is
// committed 'failed' only by issue_4271_commit_refund_failed, atomically in SQL,
// when refunds.create was not reached and no #2097 attempt was ever permitted;
// everything else stays pending exactly as before for reconcile.
//
// These tests drive the REAL executeTicketRefundWithFeeTruth with a fake Stripe
// and a fake database that mirrors the SQL (the #2097 functions refuse a refund
// that is not pending; the commit re-checks every attempt), wired exactly the
// way refund-order wires them, and pin:
//   S1  a permission error before refunds.create -> 'failed', and a fresh refund
//       of the same tickets then goes through (one Stripe refund).
//   S2  a permission error thrown BY refunds.create -> 'unknown', still pending;
//       a later same-key retry makes exactly one Stripe refund.
//   S3  a connection error on refunds.create (Stripe may have made it) -> pending;
//       the same-key retry gets Stripe's original refund: exactly one refund.
//   S4  a definitive error on a replay whose earlier request reached Stripe ->
//       'unknown'; a replay whose attempts never reached Stripe -> 'failed'.
//   S5  the SQL commit is the authority: it can still answer unknown, and an
//       error or a throw from it is unknown.
//   S6  a 'failed' row never reaches Stripe again, even replayed with its key.
//   S7  refund-order, admin-refund-order and admin-reconcile-ticket-refund wire
//       the tracker, the key binding, the atomic commit and the status refusals.
//   S8  boundRefundProviderKey accepts only this refund's own host/admin key.
//
// FAILS-ON-REVERT: drop the createInvoked guard in settleStripeRefundThrow and S2
// fails; read the commit outcome as success regardless and S5 fails; delete the
// failed-replay return in refund-order/index.ts and S7 fails.

import { executeTicketRefundWithFeeTruth } from "../../_shared/issue2097TicketRefundTruth.ts";
import {
  boundRefundProviderKey,
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

// ── Fake database: refunds rows + the #2097 attempt RPCs, mirroring the SQL. ──
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
  const refunds = new Map<
    string,
    { status: string; stripe_refund_id: string | null; quantity: number }
  >();
  const attempts: Attempt[] = [];
  const commits: Array<Record<string, unknown>> = [];
  let seq = 0;
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const conflict = (message: string) =>
    Promise.resolve({ data: null, error: { message } });
  const pending = (refundId: unknown) =>
    refunds.get(String(refundId))?.status === "pending";
  const rpc = (name: string, args: Record<string, unknown>) => {
    if (name === "issue_4271_commit_refund_failed") {
      // Mirrors the SQL: one decision under the refunds row lock.
      commits.push(args);
      const row = refunds.get(String(args.p_refund_id));
      if (!row) return conflict("refund_not_found");
      if (row.status === "failed") {
        return ok({ outcome: "failed", idempotent_replay: true });
      }
      if (row.status !== "pending") {
        return ok({ outcome: "unknown", reason: "refund_not_pending" });
      }
      if (args.p_provider_call_reached !== false) {
        return ok({ outcome: "unknown", reason: "provider_call_reached" });
      }
      if (row.stripe_refund_id) {
        return ok({ outcome: "unknown", reason: "provider_refund_recorded" });
      }
      const mine = attempts.filter((a) => a.refund_id === args.p_refund_id);
      if (mine.some((a) => a.provider_call_permitted_at || a.buyer_refund_id)) {
        return ok({ outcome: "unknown", reason: "provider_call_permitted" });
      }
      for (const a of mine) {
        if (a.status === "awaiting_application_fee") {
          a.status = "application_fee_timeout";
        }
      }
      row.status = "failed";
      return ok({ outcome: "failed", idempotent_replay: false });
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
      if (!pending(args.p_refund_id)) return conflict("refund_not_pending");
      const attempt: Attempt = {
        id: `att_${++seq}`,
        refund_id: String(args.p_refund_id),
        request_fingerprint: String(args.p_request_fingerprint),
        status: "awaiting_application_fee",
        provider_call_permitted_at: new Date().toISOString(),
        buyer_refund_id: null,
        baseline_fee_refund_ids: args.p_baseline_fee_refund_ids as string[],
        baseline_amount_refunded_text: String(
          args.p_baseline_amount_refunded_text,
        ),
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
      if (
        !["awaiting_application_fee", "pending_visibility"].includes(
          attempt.status,
        ) ||
        // Mirrors the SQL: a non-pending row refuses only an attempt that was
        // never permitted and holds no buyer refund; money that moved settles.
        (!pending(attempt.refund_id) && !attempt.provider_call_permitted_at &&
          !attempt.buyer_refund_id)
      ) {
        return ok({
          claimed: false,
          status: attempt.status,
          lease_epoch: attempt.lease_epoch,
        });
      }
      attempt.lease_epoch += 1;
      return ok({
        claimed: true,
        status: attempt.status,
        lease_epoch: attempt.lease_epoch,
      });
    }
    if (name === "issue_2097_record_buyer_refund") {
      const attempt = attempts.find((a) => a.id === args.p_attempt_id)!;
      attempt.buyer_refund_id = String(args.p_buyer_refund_id);
      attempt.status = "pending_visibility";
      refunds.get(attempt.refund_id)!.stripe_refund_id =
        attempt.buyer_refund_id;
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
      not: (column: string, _op: string, _value: unknown) => {
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
  // The preview's capacity rule for one 2-ticket line: pending + succeeded count.
  const previewAllows = (quantity: number) => {
    let existing = 0;
    for (const row of refunds.values()) {
      if (row.status === "pending" || row.status === "succeeded") {
        existing += row.quantity;
      }
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
  const feeRefunds: Array<
    { id: string; fee: string; amount: number; currency: string }
  > = [];
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
      listRefunds: () =>
        Promise.resolve({ data: [...feeRefunds], has_more: false }),
    },
    refunds: {
      create: (
        _params: Record<string, unknown>,
        options: Record<string, unknown>,
      ) => {
        calls += 1;
        const key = String(options.idempotencyKey);
        createKeys.push(key);
        const land = () => {
          if (!byKey.has(key)) {
            byKey.set(key, { id: `re_${byKey.size + 1}`, amount: 2000 });
            feeRefunds.push({
              id: `fr_${feeRefunds.length + 1}`,
              fee: "fee_1",
              amount: 100,
              currency: "gbp",
            });
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
) {
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
          {
            idempotencyKey: `ticket_refund:${refundId}`,
            stripeAccount: "acct_1",
          },
        )
      ),
    });
    return { thrown: false, outcome: result.status };
  } catch (err) {
    const outcome = await settleStripeRefundThrow({
      error: err,
      tracker: refundCreate,
      loadPermittedNow: () => refundEverPermittedProviderCall(db, refundId),
      commitFailed: (providerCallReached) =>
        db.rpc("issue_4271_commit_refund_failed", {
          p_refund_id: refundId,
          p_provider_call_reached: providerCallReached,
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
  db.refunds.set("refund_a", {
    status: "pending",
    stripe_refund_id: null,
    quantity: 2,
  });
  const denied = fakeStripe({ piError: permissionDenied });
  const first = await runRefundArm(db, denied, "refund_a");
  assertEquals(
    first,
    { thrown: true, outcome: "failed" },
    "first attempt outcome",
  );
  assertEquals(
    db.refunds.get("refund_a")!.status,
    "failed",
    "stuck row is committed failed",
  );
  assertEquals(db.commits, [{
    p_refund_id: "refund_a",
    p_provider_call_reached: false,
  }], "one atomic commit");
  assertEquals(
    denied.createKeys.length,
    0,
    "Stripe refunds.create was never called",
  );
  assertEquals(
    db.previewAllows(2),
    true,
    "the preview no longer counts the failed row",
  );

  // Permissions fixed: the host's next refund is a new row and goes through once.
  db.refunds.set("refund_b", {
    status: "pending",
    stripe_refund_id: null,
    quantity: 2,
  });
  const fixed = fakeStripe({});
  const second = await runRefundArm(db, fixed, "refund_b");
  assertEquals(
    second,
    { thrown: false, outcome: "succeeded_positive" },
    "second attempt",
  );
  assertEquals(
    db.refunds.get("refund_b")!.status,
    "succeeded",
    "new row succeeded",
  );
  assertEquals(fixed.byKey.size, 1, "exactly one Stripe refund");
});

Deno.test("S2 permission error thrown by refunds.create itself: unknown, pending, and one refund on retry", async () => {
  const db = fakeDb();
  db.refunds.set("refund_c", {
    status: "pending",
    stripe_refund_id: null,
    quantity: 2,
  });
  const provider = fakeStripe({
    createError: (call) => call === 1 ? permissionDenied() : null,
  });
  const result = await runRefundArm(db, provider, "refund_c");
  assertEquals(
    result,
    { thrown: true, outcome: "unknown" },
    "a reached refunds.create is never failed",
  );
  assertEquals(db.commits.length, 0, "no commit was even attempted");
  assertEquals(
    db.refunds.get("refund_c")!.status,
    "pending",
    "row stays pending",
  );
  assertEquals(
    db.previewAllows(2),
    false,
    "the pending row still holds its tickets",
  );
  const retry = await runRefundArm(db, provider, "refund_c");
  assertEquals(
    retry,
    { thrown: false, outcome: "succeeded_positive" },
    "same-key retry settles",
  );
  assertEquals(provider.createKeys, [
    "ticket_refund:refund_c",
    "ticket_refund:refund_c",
  ], "one key throughout");
  assertEquals(provider.byKey.size, 1, "exactly one Stripe refund");
});

Deno.test("S3 connection error on refunds.create: row stays pending and the same-key retry makes one refund", async () => {
  const db = fakeDb();
  db.refunds.set("refund_d", {
    status: "pending",
    stripe_refund_id: null,
    quantity: 2,
  });
  const provider = fakeStripe({
    createError: (call) =>
      call === 1
        ? stripeError("StripeConnectionError", { statusCode: undefined })
        : null,
    createLandsDespiteError: true,
  });
  const first = await runRefundArm(db, provider, "refund_d");
  assertEquals(
    first,
    { thrown: true, outcome: "unknown" },
    "first attempt is unknown",
  );
  assertEquals(
    db.refunds.get("refund_d")!.status,
    "pending",
    "row stays pending",
  );
  assertEquals(db.commits.length, 0, "nothing committed failed");

  const retry = await runRefundArm(db, provider, "refund_d");
  assertEquals(
    retry,
    { thrown: false, outcome: "succeeded_positive" },
    "retry resolves",
  );
  assertEquals(
    provider.createKeys,
    ["ticket_refund:refund_d", "ticket_refund:refund_d"],
    "both calls used the row's own Stripe idempotency key",
  );
  assertEquals(provider.byKey.size, 1, "exactly one Stripe refund exists");
  assertEquals(
    db.refunds.get("refund_d")!.status,
    "succeeded",
    "row succeeded",
  );
});

Deno.test("S4 a replay whose earlier request reached Stripe stays unknown; one that never did fails", async () => {
  const db = fakeDb();
  db.refunds.set("refund_e", {
    status: "pending",
    stripe_refund_id: null,
    quantity: 2,
  });
  const flaky = fakeStripe({
    createError: () => stripeError("StripeAPIError", { statusCode: 500 }),
  });
  assertEquals(
    (await runRefundArm(db, flaky, "refund_e")).outcome,
    "unknown",
    "5xx is unknown",
  );
  const readDenied = fakeStripe({ piError: permissionDenied });
  const replay = await runRefundArm(db, readDenied, "refund_e");
  assertEquals(
    replay,
    { thrown: true, outcome: "unknown" },
    "replay never marks failed",
  );
  assertEquals(
    db.refunds.get("refund_e")!.status,
    "pending",
    "row stays pending",
  );

  db.refunds.set("refund_f", {
    status: "pending",
    stripe_refund_id: null,
    quantity: 2,
  });
  assertEquals(
    await runRefundArm(db, readDenied, "refund_f"),
    { thrown: true, outcome: "failed" },
    "a row with no permitted attempt fails",
  );
});

Deno.test("S5 the SQL commit decides: unknown, error and throw all leave the row pending", async () => {
  const base = {
    error: permissionDenied(),
    tracker: { invoked: false, returned: false },
    loadPermittedNow: () => Promise.resolve(false),
    logContext: "test",
  };
  const answers: Array<
    [
      () => PromiseLike<
        { data?: unknown; error?: { message?: string } | null }
      >,
      string,
    ]
  > = [
    [
      () => Promise.resolve({ data: { outcome: "failed" }, error: null }),
      "failed",
    ],
    [
      () =>
        Promise.resolve({
          data: { outcome: "unknown", reason: "provider_call_permitted" },
          error: null,
        }),
      "unknown",
    ],
    [() => Promise.resolve({ data: null, error: null }), "unknown"],
    [
      () =>
        Promise.resolve({
          data: { outcome: "failed" },
          error: { message: "boom" },
        }),
      "unknown",
    ],
    [() => Promise.reject(new Error("socket hang up")), "unknown"],
  ];
  for (const [commitFailed, expected] of answers) {
    assertEquals(
      await settleStripeRefundThrow({ ...base, commitFailed }),
      expected,
      `commit answer -> ${expected}`,
    );
  }
  let called = false;
  assertEquals(
    await settleStripeRefundThrow({
      ...base,
      loadPermittedNow: () => Promise.resolve(true),
      commitFailed: () => {
        called = true;
        return Promise.resolve({ data: { outcome: "failed" }, error: null });
      },
    }),
    "unknown",
    "a permitted attempt is unknown before any commit",
  );
  assertEquals(called, false, "no commit when an attempt was permitted");
});

Deno.test("S6 a failed row never reaches Stripe again, even replayed under its own key", async () => {
  const db = fakeDb();
  db.refunds.set("refund_g", {
    status: "pending",
    stripe_refund_id: null,
    quantity: 2,
  });
  assertEquals(
    (await runRefundArm(
      db,
      fakeStripe({ piError: permissionDenied }),
      "refund_g",
    )).outcome,
    "failed",
    "failed",
  );
  const healthy = fakeStripe({});
  const replay = await runRefundArm(db, healthy, "refund_g");
  assertEquals(
    replay,
    { thrown: true, outcome: "failed" },
    "prepare refuses; the row is still failed",
  );
  assertEquals(
    healthy.createKeys.length,
    0,
    "Stripe was never called for the failed row",
  );
});

Deno.test("S7 the refund functions wire the binding, the atomic commit and the status refusals", async () => {
  const root = new URL("../../", import.meta.url);
  for (
    const [path, prefix] of [["refund-order/index.ts", "ticket_refund"], [
      "admin-refund-order/index.ts",
      "admin_refund",
    ]]
  ) {
    const source = await Deno.readTextFile(new URL(path, root));
    const failedReplay = source.indexOf('existing?.status === "failed"');
    const bind = source.indexOf('"issue_4271_bind_refund_provider_key"');
    const create = source.indexOf("createBuyerRefund: refundCreate.track(");
    const settle = source.indexOf("await settleStripeRefundThrow(", create);
    const commit = source.indexOf('"issue_4271_commit_refund_failed"', settle);
    if (failedReplay < 0 || failedReplay > bind) {
      throw new Error(
        `${path}: a failed replay is not refused before the provider`,
      );
    }
    if (bind < 0 || bind > create) {
      throw new Error(
        `${path}: the Stripe key is not bound before refunds.create`,
      );
    }
    if (!source.includes(`p_provider_key: \`${prefix}:\${refundId}\``)) {
      throw new Error(`${path}: binds the wrong key`);
    }
    if (create < 0) throw new Error(`${path}: refunds.create is not tracked`);
    if (settle < 0) {
      throw new Error(`${path}: the Stripe catch does not settle the row`);
    }
    if (commit < 0) {
      throw new Error(
        `${path}: the settle step does not use the atomic commit`,
      );
    }
    if (
      source.includes("resumeStuckRefund") ||
      source.includes("issue_4271_resumable")
    ) {
      throw new Error(`${path}: the dropped resume path is still wired`);
    }
  }
  const reconcile = await Deno.readTextFile(
    new URL("admin-reconcile-ticket-refund/index.ts", root),
  );
  if (!reconcile.includes('refund.status !== "pending"')) {
    throw new Error("reconcile drives non-pending refunds");
  }
  if (
    !reconcile.includes("boundRefundProviderKey(") ||
    !reconcile.includes("providerIdempotencyKey,\n")
  ) {
    throw new Error(
      "reconcile does not replay under the refund's own Stripe key",
    );
  }
});

Deno.test("S8 boundRefundProviderKey accepts only this refund's own host or admin key", () => {
  assertEquals(
    boundRefundProviderKey("r1", {
      provider_idempotency_key: "ticket_refund:r1",
    }),
    "ticket_refund:r1",
    "host",
  );
  assertEquals(
    boundRefundProviderKey("r1", {
      provider_idempotency_key: "admin_refund:r1",
    }),
    "admin_refund:r1",
    "admin",
  );
  for (
    const metadata of [
      null,
      {},
      { provider_idempotency_key: "ticket_refund:r2" },
      { provider_idempotency_key: "cancel_refund:r1" },
      { provider_idempotency_key: 7 },
      { idempotency_key: "ticket_refund:r1" },
    ]
  ) {
    assertEquals(
      boundRefundProviderKey("r1", metadata),
      null,
      `refused ${JSON.stringify(metadata)}`,
    );
  }
});
