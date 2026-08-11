/**
 * #1807 — happy-path regression test for the Paystack lane of the admin
 * payout-hold migration edge fn.
 *
 * Before #1807 a Paystack-only (Nigerian) brand had no stripe_connect_accounts
 * row, so the fn recorded skipped_no_account and `continue`d — the brand could
 * NEVER be stamped, and issue_1389_prepare_payment therefore always raised
 * stay_bank_not_ready for NGN Stay bookings.
 *
 * Deps-injected (no network, no DB): mocks the supabase client + the Stripe
 * schedule helpers, mirroring issue_1173_admin_migrate.test.ts.
 *
 * Fails-on-revert: deleting the `if (!stripeAccountId) { … Paystack lane … }`
 * block (and the `&& !hasPaystackRecipient` guard) makes the Paystack-only
 * brand fall back to skipped_no_account, so the "stamped with a null stripe
 * account id" assertions fail.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleAdminPayoutHoldMigrate, type MigrateDeps } from "../index.ts";

interface BrandState {
  stripe_account_id: string | null;
  /** an ACTIVE brand_paystack_recipients row exists */
  paystack_active: boolean;
  /** an INACTIVE recipient row exists (is_active = false) */
  paystack_inactive?: boolean;
  cutover_at: string | null;
}

interface MockOptions {
  user?: { id: string; email: string } | null;
  isAdmin?: boolean;
  brands: Record<string, BrandState>;
  stampReject?: boolean;
  rollbackReject?: boolean;
  /**
   * The stamp RPC returns 'skipped_already_stamped' — i.e. another session won
   * the race between this fn's read and the RPC's own FOR UPDATE lock. The RPC
   * is the authority; the fn must report the skip, not a flip.
   */
  stampReturnsSkip?: boolean;
  /**
   * Ledger inserts whose `result` is in this set REJECT (transport-level
   * failure) instead of returning `{ error }`. Used to reach the fn's outer
   * unexpected-error catch — the only place `flip_failed` can still be
   * recorded for a brand that has no Stripe account.
   */
  rejectLedgerFor?: Set<string>;
}

interface SelectCall {
  table: string;
  eqs: Record<string, unknown>;
}

function buildMock(opts: MockOptions) {
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const inserts: Record<string, unknown>[] = [];
  const selects: SelectCall[] = [];
  const flipCalls: string[] = [];
  const restoreCalls: string[] = [];

  const client = {
    auth: {
      getUser: (_token: string) =>
        Promise.resolve(
          opts.user
            ? { data: { user: opts.user }, error: null }
            : { data: { user: null }, error: new Error("bad token") },
        ),
    },
    from(table: string) {
      const eqs: Record<string, unknown> = {};
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          eqs[col] = val;
          return builder;
        },
        maybeSingle: () => {
          selects.push({ table, eqs: { ...eqs } });
          if (table === "admin_users") {
            return Promise.resolve({
              data: opts.isAdmin ? { id: "admin-1" } : null,
              error: null,
            });
          }
          if (table === "stripe_connect_accounts") {
            const b = opts.brands[eqs["brand_id"] as string];
            return Promise.resolve({
              data: b && b.stripe_account_id
                ? { stripe_account_id: b.stripe_account_id }
                : null,
              error: null,
            });
          }
          if (table === "brand_paystack_recipients") {
            const b = opts.brands[eqs["brand_id"] as string];
            // Honour the is_active filter exactly as PostgREST would: an
            // inactive row is invisible to a `.eq("is_active", true)` query.
            const active = eqs["is_active"] === true;
            const visible = b
              ? (active ? b.paystack_active : (b.paystack_inactive ?? false))
              : false;
            return Promise.resolve({
              data: visible ? { id: "rcp-row-1" } : null,
              error: null,
            });
          }
          if (table === "brands") {
            const b = opts.brands[eqs["id"] as string];
            return Promise.resolve({
              data: b ? { payout_hold_cutover_at: b.cutover_at } : null,
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        insert: (row: Record<string, unknown>) => {
          if (opts.rejectLedgerFor?.has(row.result as string)) {
            return Promise.reject(new Error("ledger transport failure"));
          }
          inserts.push({ table, ...row });
          return Promise.resolve({ error: null });
        },
      };
      return builder;
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (name === "stamp_payout_hold_cutover") {
        if (opts.stampReject) {
          return Promise.resolve({
            data: null,
            error: new Error("stamp boom"),
          });
        }
        if (opts.stampReturnsSkip) {
          const loser = opts.brands[args.p_brand_id as string];
          // The winning session already stamped it under the RPC's row lock.
          if (loser) loser.cutover_at = "2026-08-09T00:00:00Z";
          return Promise.resolve({
            data: "skipped_already_stamped",
            error: null,
          });
        }
        const b = opts.brands[args.p_brand_id as string];
        if (b) b.cutover_at = "2026-08-10T00:00:00Z"; // mutate → idempotency
        return Promise.resolve({ data: "flipped", error: null });
      }
      if (name === "rollback_payout_hold_cutover") {
        if (opts.rollbackReject) {
          return Promise.resolve({
            data: null,
            error: new Error("rollback boom"),
          });
        }
        const b = opts.brands[args.p_brand_id as string];
        if (b) b.cutover_at = null;
        return Promise.resolve({ data: "rolled_back", error: null });
      }
      if (name === "admin_write_audit") {
        return Promise.resolve({ data: "audit-id", error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };

  const deps: MigrateDeps = {
    env: (k) =>
      k === "SUPABASE_URL"
        ? "https://x.test"
        : k === "SUPABASE_SERVICE_ROLE_KEY"
        ? "svc"
        : undefined,
    createAdmin: (() => client) as never,
    setManualPayoutSchedule: (accountId: string) => {
      flipCalls.push(accountId);
      return Promise.resolve({ id: accountId });
    },
    restoreDailyPayoutSchedule: (accountId: string) => {
      restoreCalls.push(accountId);
      return Promise.resolve({ id: accountId });
    },
  };

  return { deps, rpcCalls, inserts, selects, flipCalls, restoreCalls };
}

const ADMIN = { id: "user-1", email: "admin@usemingla.com" };
/** Paystack-only (Nigerian) brand. */
const NG = "aaaaaaaa-1807-4000-8000-000000000001";
/** Stripe brand — the unchanged-behaviour control. */
const US = "bbbbbbbb-1807-4000-8000-000000000002";
/** Neither rail. */
const NONE = "cccccccc-1807-4000-8000-000000000003";

function post(body: unknown, auth = "Bearer good"): Request {
  return new Request("https://x.test/functions/v1/admin-payout-hold-migrate", {
    method: "POST",
    headers: { authorization: auth, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ledgerRows(inserts: Record<string, unknown>[]) {
  return inserts.filter((r) => r.table === "payout_hold_cutover_migrations");
}

Deno.test("#1807 hold: a Paystack-only brand is stamped with a NULL stripe account id and no Stripe call", async () => {
  const brands: Record<string, BrandState> = {
    [NG]: { stripe_account_id: null, paystack_active: true, cutover_at: null },
  };
  const mock = buildMock({ user: ADMIN, isAdmin: true, brands });

  const res = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [NG], reason: "ng cutover" }),
    mock.deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();

  assertEquals(body.counts.flipped, 1);
  assertEquals(body.counts.skipped_no_account, 0);
  assertEquals(body.results[0].result, "flipped");

  // The stamp RPC ran with a NULL account id (the ledger row for a successful
  // stamp is written INSIDE that RPC).
  const stamps = mock.rpcCalls.filter((c) =>
    c.name === "stamp_payout_hold_cutover"
  );
  assertEquals(stamps.length, 1);
  assertEquals(stamps[0].args.p_brand_id, NG);
  assertEquals(stamps[0].args.p_stripe_account_id, null);

  // No provider mutation and NO compensation on this rail.
  assertEquals(mock.flipCalls.length, 0);
  assertEquals(mock.restoreCalls.length, 0);

  // The recipient lookup filtered on is_active = true.
  const recipientSelects = mock.selects.filter((s) =>
    s.table === "brand_paystack_recipients"
  );
  assertEquals(recipientSelects.length, 1);
  assertEquals(recipientSelects[0].eqs.brand_id, NG);
  assertEquals(recipientSelects[0].eqs.is_active, true);

  // Admin audit trail written for the brand.
  const audits = mock.rpcCalls.filter((c) => c.name === "admin_write_audit");
  assertEquals(audits.length, 1);
  assertEquals(
    (audits[0].args.p_metadata as Record<string, unknown>).result,
    "flipped",
  );
  assertEquals(
    (audits[0].args.p_metadata as Record<string, unknown>).stripe_account_id,
    null,
  );

  assertEquals(brands[NG].cutover_at, "2026-08-10T00:00:00Z");
});

Deno.test("#1807 hold: re-running a stamped Paystack brand is skipped_already_stamped with a NULL-interval ledger row", async () => {
  const brands: Record<string, BrandState> = {
    [NG]: { stripe_account_id: null, paystack_active: true, cutover_at: null },
  };
  const mock = buildMock({ user: ADMIN, isAdmin: true, brands });

  await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [NG], reason: "ng cutover" }),
    mock.deps,
  );
  const stampsBefore =
    mock.rpcCalls.filter((c) => c.name === "stamp_payout_hold_cutover").length;
  const ledgerBefore = ledgerRows(mock.inserts).length;

  const res = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [NG], reason: "ng cutover rerun" }),
    mock.deps,
  );
  const body = await res.json();
  assertEquals(body.counts.skipped_already_stamped, 1);
  assertEquals(body.counts.flipped, 0);

  // ZERO new stamp mutations.
  assertEquals(
    mock.rpcCalls.filter((c) => c.name === "stamp_payout_hold_cutover").length,
    stampsBefore,
  );

  // Exactly one new append-only ledger row, truthfully shaped: no stripe
  // account, and NULL schedule intervals (a Stripe-only concept).
  const rows = ledgerRows(mock.inserts);
  assertEquals(rows.length, ledgerBefore + 1);
  const row = rows[rows.length - 1];
  assertEquals(row.brand_id, NG);
  assertEquals(row.result, "skipped_already_stamped");
  assertEquals(row.stripe_account_id, null);
  assertEquals(row.prior_interval, null);
  assertEquals(row.new_interval, null);
  assertEquals(row.direction, "hold");
  assertEquals(row.cutover_before, "2026-08-10T00:00:00Z");
  assertEquals(row.cutover_after, "2026-08-10T00:00:00Z");
});

Deno.test("#1807 hold: a brand with neither rail still records skipped_no_account", async () => {
  const brands: Record<string, BrandState> = {
    [NONE]: {
      stripe_account_id: null,
      paystack_active: false,
      cutover_at: null,
    },
  };
  const mock = buildMock({ user: ADMIN, isAdmin: true, brands });
  const res = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [NONE], reason: "no rail" }),
    mock.deps,
  );
  const body = await res.json();
  assertEquals(body.counts.skipped_no_account, 1);
  assertEquals(body.counts.flipped, 0);
  assertEquals(mock.flipCalls.length, 0);
  assertEquals(
    mock.rpcCalls.filter((c) => c.name === "stamp_payout_hold_cutover").length,
    0,
  );
  const rows = ledgerRows(mock.inserts);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].result, "skipped_no_account");
  assertEquals(rows[0].stripe_account_id, null);
});

Deno.test("#1807 hold: an INACTIVE Paystack recipient is not a rail — still skipped_no_account", async () => {
  const brands: Record<string, BrandState> = {
    [NONE]: {
      stripe_account_id: null,
      paystack_active: false,
      paystack_inactive: true,
      cutover_at: null,
    },
  };
  const mock = buildMock({ user: ADMIN, isAdmin: true, brands });
  const res = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [NONE], reason: "inactive recipient" }),
    mock.deps,
  );
  const body = await res.json();
  assertEquals(body.counts.skipped_no_account, 1);
  assertEquals(
    mock.rpcCalls.filter((c) => c.name === "stamp_payout_hold_cutover").length,
    0,
  );
});

Deno.test("#1807: a Stripe brand's path is UNCHANGED — flip + stamp with its account id, and no recipient lookup", async () => {
  const brands: Record<string, BrandState> = {
    [US]: {
      stripe_account_id: "acct_1",
      paystack_active: false,
      cutover_at: null,
    },
  };
  const mock = buildMock({ user: ADMIN, isAdmin: true, brands });
  const res = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [US], reason: "stripe control" }),
    mock.deps,
  );
  const body = await res.json();
  assertEquals(body.counts.flipped, 1);
  assertEquals(mock.flipCalls, ["acct_1"]);
  const stamps = mock.rpcCalls.filter((c) =>
    c.name === "stamp_payout_hold_cutover"
  );
  assertEquals(stamps.length, 1);
  assertEquals(stamps[0].args.p_stripe_account_id, "acct_1");
  // The Paystack lookup must NEVER run for a brand that has a Stripe account.
  assertEquals(
    mock.selects.filter((s) => s.table === "brand_paystack_recipients").length,
    0,
  );
});

Deno.test("#1807 rollback: a Paystack-only brand is un-stamped with a NULL account id and no Stripe call", async () => {
  const brands: Record<string, BrandState> = {
    [NG]: {
      stripe_account_id: null,
      paystack_active: true,
      cutover_at: "2026-08-01T00:00:00Z",
    },
  };
  const mock = buildMock({ user: ADMIN, isAdmin: true, brands });
  const res = await handleAdminPayoutHoldMigrate(
    post({
      brand_ids: [NG],
      reason: "ng rollback",
      direction: "rollback",
    }),
    mock.deps,
  );
  const body = await res.json();
  assertEquals(body.counts.rolled_back, 1);
  const rollbacks = mock.rpcCalls.filter((c) =>
    c.name === "rollback_payout_hold_cutover"
  );
  assertEquals(rollbacks.length, 1);
  assertEquals(rollbacks[0].args.p_stripe_account_id, null);
  assertEquals(mock.restoreCalls.length, 0); // no Paystack schedule concept
  assertEquals(brands[NG].cutover_at, null);
  const audits = mock.rpcCalls.filter((c) => c.name === "admin_write_audit");
  assertEquals(audits.length, 1);
  assertEquals(
    (audits[0].args.p_metadata as Record<string, unknown>).result,
    "rolled_back",
  );
});

Deno.test("#1807 hold: a failed stamp on the Paystack lane leaves the brand untouched, with NO compensation call", async () => {
  const brands: Record<string, BrandState> = {
    [NG]: { stripe_account_id: null, paystack_active: true, cutover_at: null },
  };
  const mock = buildMock({
    user: ADMIN,
    isAdmin: true,
    brands,
    stampReject: true,
  });
  const res = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [NG], reason: "stamp failure" }),
    mock.deps,
  );
  const body = await res.json();
  // stamp_failed, NOT stamp_failed_rolled_back (nothing was rolled back) and
  // NOT flip_failed (there is no schedule flip on this rail).
  assertEquals(body.counts.stamp_failed, 1);
  assertEquals(body.counts.stamp_failed_rolled_back, 0);
  assertEquals(body.counts.flip_failed, 0);
  assertEquals(mock.restoreCalls.length, 0); // nothing to compensate
  assertEquals(brands[NG].cutover_at, null); // unchanged
  const rows = ledgerRows(mock.inserts);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].result, "stamp_failed");
  assertEquals(rows[0].stripe_account_id, null);
  assertEquals(rows[0].prior_interval, null);
  assertEquals(rows[0].new_interval, null);
  assert(typeof rows[0].error_message === "string");
});

Deno.test("#1807 hold: dry_run on the Paystack lane reports the would-be flip and mutates nothing", async () => {
  const brands: Record<string, BrandState> = {
    [NG]: { stripe_account_id: null, paystack_active: true, cutover_at: null },
  };
  const mock = buildMock({ user: ADMIN, isAdmin: true, brands });
  const res = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [NG], reason: "dry", dry_run: true }),
    mock.deps,
  );
  const body = await res.json();
  assertEquals(body.dry_run, true);
  assertEquals(body.results[0].result, "flipped"); // would-be
  assertEquals(mock.inserts.length, 0);
  assertEquals(mock.rpcCalls.length, 0);
  assertEquals(mock.flipCalls.length, 0);
  assertEquals(brands[NG].cutover_at, null);
});

Deno.test("#1807 batch: Paystack, Stripe and no-rail brands are each isolated in one batch", async () => {
  const brands: Record<string, BrandState> = {
    [NG]: { stripe_account_id: null, paystack_active: true, cutover_at: null },
    [US]: {
      stripe_account_id: "acct_1",
      paystack_active: false,
      cutover_at: null,
    },
    [NONE]: {
      stripe_account_id: null,
      paystack_active: false,
      cutover_at: null,
    },
  };
  const mock = buildMock({ user: ADMIN, isAdmin: true, brands });
  const res = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [NG, US, NONE], reason: "mixed batch" }),
    mock.deps,
  );
  const body = await res.json();
  assertEquals(body.counts.flipped, 2);
  assertEquals(body.counts.skipped_no_account, 1);
  assertEquals(mock.flipCalls, ["acct_1"]); // only the Stripe brand
  const stampAccounts = mock.rpcCalls
    .filter((c) => c.name === "stamp_payout_hold_cutover")
    .map((c) => c.args.p_stripe_account_id);
  assertEquals(stampAccounts, [null, "acct_1"]);
});

Deno.test("#1807 hold: an UNEXPECTED failure on the Paystack lane records stamp_failed, never flip_failed", async () => {
  // Already stamped → takes the idempotent-skip path, whose ledger insert is
  // rigged to reject at transport level. That lands in the fn's outer catch,
  // which is the last place a non-Stripe brand could have been recorded as a
  // failed schedule flip.
  const brands: Record<string, BrandState> = {
    [NG]: {
      stripe_account_id: null,
      paystack_active: true,
      cutover_at: "2026-08-01T00:00:00Z",
    },
  };
  const mock = buildMock({
    user: ADMIN,
    isAdmin: true,
    brands,
    rejectLedgerFor: new Set(["skipped_already_stamped"]),
  });
  const res = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [NG], reason: "transport failure" }),
    mock.deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.counts.stamp_failed, 1);
  assertEquals(body.counts.flip_failed, 0);
  assertEquals(mock.flipCalls.length, 0);
  assertEquals(mock.restoreCalls.length, 0);
  const rows = ledgerRows(mock.inserts);
  assertEquals(rows.length, 1); // the catch's own ledger row
  assertEquals(rows[0].result, "stamp_failed");
  assertEquals(rows[0].stripe_account_id, null);
});

Deno.test("#1807: the same UNEXPECTED failure on a STRIPE brand still records flip_failed — outer catch unchanged", async () => {
  const brands: Record<string, BrandState> = {
    [US]: {
      stripe_account_id: "acct_1",
      paystack_active: false,
      cutover_at: "2026-08-01T00:00:00Z",
    },
  };
  const mock = buildMock({
    user: ADMIN,
    isAdmin: true,
    brands,
    rejectLedgerFor: new Set(["skipped_already_stamped"]),
  });
  const res = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [US], reason: "transport failure" }),
    mock.deps,
  );
  const body = await res.json();
  assertEquals(body.counts.flip_failed, 1);
  assertEquals(body.counts.stamp_failed, 0);
  const rows = ledgerRows(mock.inserts);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].result, "flip_failed");
});

Deno.test("#1807: stamp_failed is an additive counter — zero on an all-Stripe batch", async () => {
  const brands: Record<string, BrandState> = {
    [US]: {
      stripe_account_id: "acct_1",
      paystack_active: false,
      cutover_at: null,
    },
  };
  const mock = buildMock({ user: ADMIN, isAdmin: true, brands });
  const res = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [US], reason: "counter shape" }),
    mock.deps,
  );
  const body = await res.json();
  assertEquals(body.counts.stamp_failed, 0);
  assertEquals(body.counts.flipped, 1);
  // Every pre-existing counter key is still present and untouched.
  for (
    const key of [
      "flipped",
      "skipped_already_stamped",
      "skipped_no_account",
      "flip_failed",
      "stamp_failed_rolled_back",
      "rolled_back",
      "rollback_failed",
    ]
  ) {
    assert(key in body.counts, `counts lost the ${key} key`);
  }
});

Deno.test("#1807 hold: a PAYSTACK concurrency loser is audited as a skip, not a flip", async () => {
  // The fn reads cutover_at as NULL, then the RPC — which re-checks under its
  // own FOR UPDATE lock — reports that another session won. The RPC is the
  // authority: reporting 'flipped' here would contradict the ledger row the
  // RPC itself wrote.
  const brands: Record<string, BrandState> = {
    [NG]: { stripe_account_id: null, paystack_active: true, cutover_at: null },
  };
  const mock = buildMock({
    user: ADMIN,
    isAdmin: true,
    brands,
    stampReturnsSkip: true,
  });
  const res = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [NG], reason: "concurrent stamp" }),
    mock.deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.counts.skipped_already_stamped, 1);
  assertEquals(body.counts.flipped, 0);
  assertEquals(body.results[0].result, "skipped_already_stamped");

  // The admin audit trail must agree with the ledger.
  const audits = mock.rpcCalls.filter((c) => c.name === "admin_write_audit");
  assertEquals(audits.length, 1);
  assertEquals(
    (audits[0].args.p_metadata as Record<string, unknown>).result,
    "skipped_already_stamped",
  );
  // Still no provider mutation on this rail.
  assertEquals(mock.flipCalls.length, 0);
  assertEquals(mock.restoreCalls.length, 0);
});

Deno.test("#1807 hold: a STRIPE concurrency loser is audited as a skip, not a flip", async () => {
  const brands: Record<string, BrandState> = {
    [US]: {
      stripe_account_id: "acct_1",
      paystack_active: false,
      cutover_at: null,
    },
  };
  const mock = buildMock({
    user: ADMIN,
    isAdmin: true,
    brands,
    stampReturnsSkip: true,
  });
  const res = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [US], reason: "concurrent stamp" }),
    mock.deps,
  );
  const body = await res.json();
  assertEquals(body.counts.skipped_already_stamped, 1);
  assertEquals(body.counts.flipped, 0);
  const audits = mock.rpcCalls.filter((c) => c.name === "admin_write_audit");
  assertEquals(audits.length, 1);
  assertEquals(
    (audits[0].args.p_metadata as Record<string, unknown>).result,
    "skipped_already_stamped",
  );
  assertEquals(
    (audits[0].args.p_metadata as Record<string, unknown>).stripe_account_id,
    "acct_1",
  );
  // The flip already fired before the stamp and is NOT compensated — an
  // already-stamped brand belongs on the manual schedule. No restore.
  assertEquals(mock.flipCalls, ["acct_1"]);
  assertEquals(mock.restoreCalls.length, 0);
});

Deno.test("#1807 hold: a normal (uncontended) stamp still reports flipped on both rails", async () => {
  // Guards the read of the RPC's return value against over-correcting: when
  // the RPC says 'flipped', the fn must still say flipped.
  const brands: Record<string, BrandState> = {
    [NG]: { stripe_account_id: null, paystack_active: true, cutover_at: null },
    [US]: {
      stripe_account_id: "acct_1",
      paystack_active: false,
      cutover_at: null,
    },
  };
  const mock = buildMock({ user: ADMIN, isAdmin: true, brands });
  const res = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [NG, US], reason: "uncontended" }),
    mock.deps,
  );
  const body = await res.json();
  assertEquals(body.counts.flipped, 2);
  assertEquals(body.counts.skipped_already_stamped, 0);
  for (
    const audit of mock.rpcCalls.filter((c) => c.name === "admin_write_audit")
  ) {
    assertEquals(
      (audit.args.p_metadata as Record<string, unknown>).result,
      "flipped",
    );
  }
});
