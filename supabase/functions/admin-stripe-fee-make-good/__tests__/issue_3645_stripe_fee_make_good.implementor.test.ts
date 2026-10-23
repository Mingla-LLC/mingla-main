/**
 * Issue #3645 option b \u2014 admin-stripe-fee-make-good handler.
 *
 * Deps-injected (no network, no DB). The fake ledger mirrors the SQL contract
 * of plan_/record_stripe_fee_make_good (20271213003645): the amount and the
 * idempotency key come from the plan, a planned row is resumed with the same
 * key, and only 'sent' or a definitive 'failed' is recorded.
 *
 * Fails-on-revert: sending a Transfer whose amount or key is not the plan's, or
 * recording 'failed' on a retryable error (which would mint a new key and could
 * pay twice), fails the happy / retry cases below.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  handleAdminStripeFeeMakeGood,
  isDefinitiveStripeError,
  type MakeGoodDeps,
  RE_ONBOARD_PATH,
  type TransferInput,
  type TransferResult,
} from "../index.ts";

const RELEASE = "3a4fa269-ecde-4cdf-94bb-1ae5604a1a64";
const BRAND = "50df414e-9e86-441a-af40-e6b9aa60e042";
const ACCT = "acct_1UQWP7IQ0qfltcWm";
const ADMIN = { id: "user-1", email: "admin@usemingla.com" };

type Row = {
  id: string;
  amount: number;
  key: string;
  status: "planned" | "sent" | "failed";
  transferId: string | null;
};

type Opts = {
  isAdmin?: boolean;
  owed?: number;
  planError?: string;
  recordError?: boolean;
  feesPayer?: string | null;
  transfer?: (input: TransferInput) => Promise<TransferResult>;
};

function harness(opts: Opts = {}) {
  const rows: Row[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const transfers: TransferInput[] = [];
  let owed = opts.owed ?? 121;
  let attempt = 0;

  const client = {
    auth: {
      getUser: (token: string) =>
        Promise.resolve(
          token === "good"
            ? { data: { user: ADMIN }, error: null }
            : { data: { user: null }, error: new Error("bad token") },
        ),
    },
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => {
          if (table === "admin_users") {
            return Promise.resolve({
              data: opts.isAdmin === false ? null : { id: "admin-1" },
              error: null,
            });
          }
          if (table === "stripe_connect_accounts") {
            return Promise.resolve({
              data: { stripe_account_id: ACCT, detached_at: null },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return builder;
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (name === "stripe_fee_make_good_census") {
        return Promise.resolve({
          data: [{ release_id: RELEASE, owed_cents: owed, eligible: true }],
          error: null,
        });
      }
      if (name === "plan_stripe_fee_make_good") {
        if (opts.planError) {
          return Promise.resolve({
            data: null,
            error: { message: opts.planError },
          });
        }
        const planned = rows.find((r) => r.status === "planned");
        if (planned) {
          if (args.p_expected_amount_cents !== planned.amount) {
            return Promise.resolve({
              data: null,
              error: { message: "make_good_amount_mismatch" },
            });
          }
          return Promise.resolve({
            data: {
              outcome: "resumed",
              make_good_id: planned.id,
              amount_cents: planned.amount,
              currency: "usd",
              stripe_account_id: ACCT,
              idempotency_key: planned.key,
            },
            error: null,
          });
        }
        if (owed <= 0) {
          return Promise.resolve({
            data: { outcome: "nothing_owed", amount_cents: 0 },
            error: null,
          });
        }
        if (args.p_expected_amount_cents !== owed) {
          return Promise.resolve({
            data: null,
            error: { message: "make_good_amount_mismatch" },
          });
        }
        const row: Row = {
          id: `mg-${rows.length + 1}`,
          amount: owed,
          key: `mingla_fee_make_good_${RELEASE}_121_a${attempt}`,
          status: "planned",
          transferId: null,
        };
        rows.push(row);
        return Promise.resolve({
          data: {
            outcome: "planned",
            make_good_id: row.id,
            amount_cents: row.amount,
            currency: "usd",
            stripe_account_id: ACCT,
            idempotency_key: row.key,
          },
          error: null,
        });
      }
      if (name === "record_stripe_fee_make_good") {
        if (opts.recordError && args.p_outcome === "sent") {
          return Promise.resolve({ data: null, error: { message: "boom" } });
        }
        const row = rows.find((r) => r.id === args.p_make_good_id)!;
        if (args.p_outcome === "sent") {
          assertEquals(args.p_amount_cents, row.amount);
          row.status = "sent";
          row.transferId = String(args.p_stripe_transfer_id);
          owed -= row.amount;
        } else {
          row.status = "failed";
          attempt++;
        }
        return Promise.resolve({ data: row.status, error: null });
      }
      if (name === "admin_write_audit") {
        return Promise.resolve({ data: "audit-id", error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };

  // Stripe idempotency: the same key returns the same Transfer.
  const byKey = new Map<string, TransferResult>();
  const deps: MakeGoodDeps = {
    env: (k) =>
      k === "SUPABASE_URL"
        ? "https://x.test"
        : k === "SUPABASE_SERVICE_ROLE_KEY"
        ? "svc"
        : undefined,
    createAdmin: (() => client) as never,
    createTransfer: (input) => {
      transfers.push(input);
      if (opts.transfer) return opts.transfer(input);
      const existing = byKey.get(input.idempotencyKey);
      if (existing) return Promise.resolve(existing);
      const created = {
        id: `tr_${byKey.size + 1}`,
        amount: input.amountCents,
        currency: input.currency,
        destination: input.destination,
      };
      byKey.set(input.idempotencyKey, created);
      return Promise.resolve(created);
    },
    retrieveFeesPayer: () =>
      Promise.resolve({
        feesPayer: opts.feesPayer === undefined ? "account" : opts.feesPayer,
        lossesPayments: "stripe",
      }),
  };
  return { deps, rows, rpcCalls, transfers, byKey };
}

function post(body: unknown, auth: string | null = "Bearer good"): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) headers.authorization = auth;
  return new Request("https://x.test/functions/v1/admin-stripe-fee-make-good", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const MAKE_GOOD = {
  mode: "make_good",
  release_id: RELEASE,
  expected_amount_cents: 121,
  reason: "Salsa4Life processing-fee make-good (#3645 option b)",
};

Deno.test("make_good sends exactly the planned amount with the planned key, then records and audits", async () => {
  const h = harness();
  const res = await handleAdminStripeFeeMakeGood(post(MAKE_GOOD), h.deps);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.outcome, "sent");
  assertEquals(body.transfer_id, "tr_1");
  assertEquals(h.transfers.length, 1);
  assertEquals(h.transfers[0], {
    amountCents: 121,
    currency: "usd",
    destination: ACCT,
    releaseId: RELEASE,
    makeGoodId: "mg-1",
    idempotencyKey: `mingla_fee_make_good_${RELEASE}_121_a0`,
  });
  const plan = h.rpcCalls.find((c) => c.name === "plan_stripe_fee_make_good")!;
  assertEquals(plan.args.p_expected_amount_cents, 121);
  assertEquals(plan.args.p_actor_email, ADMIN.email);
  assertEquals(h.rows[0].status, "sent");
  const audit = h.rpcCalls.filter((c) => c.name === "admin_write_audit");
  assertEquals(audit.length, 1);
  assertEquals(audit[0].args.p_action, "payout.stripe_fee_make_good");
  assertEquals(audit[0].args.p_entity_id, RELEASE);
  assertEquals(
    (audit[0].args.p_metadata as Record<string, unknown>).transfer_id,
    "tr_1",
  );
});

Deno.test("a second make_good after success sends nothing", async () => {
  const h = harness();
  await handleAdminStripeFeeMakeGood(post(MAKE_GOOD), h.deps);
  const res = await handleAdminStripeFeeMakeGood(
    post({ ...MAKE_GOOD, expected_amount_cents: 0 }),
    h.deps,
  );
  assertEquals((await res.json()).outcome, "nothing_owed");
  assertEquals(h.transfers.length, 1);
});

Deno.test("a retryable Stripe error leaves the row planned; the retry reuses the SAME key and pays once", async () => {
  let calls = 0;
  const h = harness({
    transfer: (input) => {
      calls++;
      if (calls === 1) {
        return Promise.reject(
          Object.assign(new Error("socket hang up"), {
            type: "StripeConnectionError",
          }),
        );
      }
      return Promise.resolve({
        id: "tr_once",
        amount: input.amountCents,
        currency: input.currency,
        destination: input.destination,
      });
    },
  });
  const first = await handleAdminStripeFeeMakeGood(post(MAKE_GOOD), h.deps);
  assertEquals(first.status, 503);
  assertEquals(h.rows.length, 1);
  assertEquals(h.rows[0].status, "planned");
  assert(
    !h.rpcCalls.some((c) => c.name === "record_stripe_fee_make_good"),
    "a retryable error must not be recorded",
  );
  const second = await handleAdminStripeFeeMakeGood(post(MAKE_GOOD), h.deps);
  assertEquals(second.status, 200);
  assertEquals((await second.json()).resumed, true);
  assertEquals(h.rows.length, 1);
  assertEquals(h.transfers[0].idempotencyKey, h.transfers[1].idempotencyKey);
  assertEquals(h.rows[0].status, "sent");
});

Deno.test("a definitive Stripe refusal is recorded failed and audited", async () => {
  const h = harness({
    transfer: () =>
      Promise.reject(
        Object.assign(new Error("Insufficient funds in Stripe account"), {
          type: "StripeInvalidRequestError",
          statusCode: 400,
        }),
      ),
  });
  const res = await handleAdminStripeFeeMakeGood(post(MAKE_GOOD), h.deps);
  assertEquals(res.status, 502);
  assertEquals((await res.json()).error, "stripe_transfer_refused");
  assertEquals(h.rows[0].status, "failed");
  const audit = h.rpcCalls.filter((c) => c.name === "admin_write_audit");
  assertEquals(audit[0].args.p_action, "payout.stripe_fee_make_good_failed");
});

Deno.test("a Transfer that does not match the plan is never recorded as sent", async () => {
  const h = harness({
    transfer: (input) =>
      Promise.resolve({
        id: "tr_wrong",
        amount: input.amountCents + 1,
        currency: input.currency,
        destination: input.destination,
      }),
  });
  const res = await handleAdminStripeFeeMakeGood(post(MAKE_GOOD), h.deps);
  assertEquals(res.status, 502);
  assertEquals((await res.json()).error, "stripe_transfer_response_mismatch");
  assertEquals(h.rows[0].status, "planned");

  const wrongDest = harness({
    transfer: (input) =>
      Promise.resolve({
        id: "tr_wrong",
        amount: input.amountCents,
        currency: input.currency,
        destination: { id: "acct_someoneElse" },
      }),
  });
  const res2 = await handleAdminStripeFeeMakeGood(post(MAKE_GOOD), wrongDest.deps);
  assertEquals(res2.status, 502);
  assertEquals(wrongDest.rows[0].status, "planned");
});

Deno.test("a ledger refusal (wrong expected amount) sends no Transfer", async () => {
  const h = harness();
  const res = await handleAdminStripeFeeMakeGood(
    post({ ...MAKE_GOOD, expected_amount_cents: 3090 }),
    h.deps,
  );
  assertEquals(res.status, 409);
  assertEquals((await res.json()).detail, "make_good_amount_mismatch");
  assertEquals(h.transfers.length, 0);
});

Deno.test("a record failure after the Transfer reports the transfer id and the retry settles it with the same key", async () => {
  const h = harness({ recordError: true });
  const res = await handleAdminStripeFeeMakeGood(post(MAKE_GOOD), h.deps);
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error, "ledger_record_failed_after_transfer");
  assertEquals(body.transfer_id, "tr_1");
  assertEquals(h.rows[0].status, "planned");
  assertEquals(h.byKey.size, 1);
});

Deno.test("auth: no token 401, non-admin 403, and neither reaches the ledger or Stripe", async () => {
  const h = harness({ isAdmin: false });
  const noAuth = await handleAdminStripeFeeMakeGood(post(MAKE_GOOD, null), h.deps);
  assertEquals(noAuth.status, 401);
  const badToken = await handleAdminStripeFeeMakeGood(
    post(MAKE_GOOD, "Bearer bad"),
    h.deps,
  );
  assertEquals(badToken.status, 401);
  const nonAdmin = await handleAdminStripeFeeMakeGood(post(MAKE_GOOD), h.deps);
  assertEquals(nonAdmin.status, 403);
  assertEquals(h.rpcCalls.length, 0);
  assertEquals(h.transfers.length, 0);
});

Deno.test("validation: reason, release id and expected amount are required", async () => {
  const h = harness();
  for (
    const bad of [
      { ...MAKE_GOOD, reason: "  \u200B" },
      { ...MAKE_GOOD, release_id: "nope" },
      { ...MAKE_GOOD, expected_amount_cents: "121" },
      { ...MAKE_GOOD, expected_amount_cents: 1.5 },
      { ...MAKE_GOOD, expected_amount_cents: -1 },
      { ...MAKE_GOOD, mode: "update_controller" },
    ]
  ) {
    const res = await handleAdminStripeFeeMakeGood(post(bad), h.deps);
    assertEquals(res.status, 400, JSON.stringify(bad));
  }
  assertEquals(h.transfers.length, 0);
});

Deno.test("fees_collector_check reports re-onboarding for a legacy account, audits, and moves no money", async () => {
  const h = harness({ feesPayer: "account" });
  const res = await handleAdminStripeFeeMakeGood(
    post({ mode: "fees_collector_check", brand_id: BRAND, reason: "census" }),
    h.deps,
  );
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.fees_payer, "account");
  assertEquals(body.migration_supported, false);
  assertEquals(body.verdict, "re_onboard_required");
  assertEquals(body.path, RE_ONBOARD_PATH);
  const audit = h.rpcCalls.filter((c) => c.name === "admin_write_audit");
  assertEquals(audit.length, 1);
  assertEquals(audit[0].args.p_action, "connect.fees_collector_check");
  assertEquals(h.transfers.length, 0);

  const already = harness({ feesPayer: "application" });
  const res2 = await handleAdminStripeFeeMakeGood(
    post({ mode: "fees_collector_check", brand_id: BRAND, reason: "census" }),
    already.deps,
  );
  const body2 = await res2.json();
  assertEquals(body2.verdict, "already_application");
  assertEquals(body2.path, null);
});

Deno.test("census is read-only", async () => {
  const h = harness();
  const res = await handleAdminStripeFeeMakeGood(post({ mode: "census" }), h.deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).releases[0].owed_cents, 121);
  assertEquals(h.transfers.length, 0);
  assertEquals(
    h.rpcCalls.map((c) => c.name),
    ["stripe_fee_make_good_census"],
  );
});

Deno.test("isDefinitiveStripeError: only a non-retryable 4xx is definitive", () => {
  assertEquals(
    isDefinitiveStripeError({ type: "StripeInvalidRequestError", statusCode: 400 }),
    true,
  );
  assertEquals(
    isDefinitiveStripeError({ type: "StripePermissionError", statusCode: 403 }),
    true,
  );
  assertEquals(isDefinitiveStripeError({ type: "StripeConnectionError" }), false);
  assertEquals(
    isDefinitiveStripeError({ type: "StripeAPIError", statusCode: 500 }),
    false,
  );
  assertEquals(
    isDefinitiveStripeError({ type: "StripeRateLimitError", statusCode: 429 }),
    false,
  );
  assertEquals(
    isDefinitiveStripeError({ type: "StripeIdempotencyError", statusCode: 400 }),
    false,
  );
  assertEquals(
    isDefinitiveStripeError({ type: "StripeInvalidRequestError", statusCode: 409 }),
    false,
  );
  assertEquals(isDefinitiveStripeError(new Error("plain")), false);
  assertEquals(isDefinitiveStripeError(null), false);
});
