/**
 * #1173 (sub-issue D of #1013) — happy-path regression test for the admin batch
 * migration edge fn (SC-5/6/7). Deps-injected (no network, no DB): mocks the
 * supabase client + the Stripe schedule helpers and asserts the atomic /
 * idempotent / batch-controlled / admin-gated behavior.
 *
 * Fails-on-revert: reverting the `if (cutoverAt !== null) → skipped_already_stamped`
 * idempotency branch makes the "re-run is a full no-op" assertion fail (a Stripe
 * flip fires on the second run).
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  handleAdminPayoutHoldMigrate,
  type MigrateDeps,
} from "../index.ts";

interface BrandState {
  stripe_account_id: string | null;
  cutover_at: string | null;
}

interface MockOptions {
  user?: { id: string; email: string } | null;
  isAdmin?: boolean;
  brands: Record<string, BrandState>;
  flipRejectAccounts?: Set<string>;
  stampReject?: boolean;
}

function buildMock(opts: MockOptions) {
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const inserts: Record<string, unknown>[] = [];
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
          return Promise.resolve({ data: null, error: new Error("stamp boom") });
        }
        const b = opts.brands[args.p_brand_id as string];
        if (b) b.cutover_at = "2026-07-26T00:00:00Z"; // mutate → idempotency
        return Promise.resolve({ data: "flipped", error: null });
      }
      if (name === "rollback_payout_hold_cutover") {
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
      if (opts.flipRejectAccounts?.has(accountId)) {
        return Promise.reject(new Error("flip 500"));
      }
      return Promise.resolve({ id: accountId });
    },
    restoreDailyPayoutSchedule: (accountId: string) => {
      restoreCalls.push(accountId);
      return Promise.resolve({ id: accountId });
    },
  };

  return { deps, rpcCalls, inserts, flipCalls, restoreCalls };
}

const ADMIN = { id: "user-1", email: "admin@usemingla.com" };
const B1 = "11111111-1111-1111-1111-111111111111";
const B2 = "22222222-2222-2222-2222-222222222222";

function post(body: unknown, auth = "Bearer good"): Request {
  return new Request("https://x.test/functions/v1/admin-payout-hold-migrate", {
    method: "POST",
    headers: auth ? { authorization: auth, "content-type": "application/json" } : { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("hold: batch of 2 unstamped brands both flip + stamp; re-run is a full no-op", async () => {
  const brands: Record<string, BrandState> = {
    [B1]: { stripe_account_id: "acct_1", cutover_at: null },
    [B2]: { stripe_account_id: "acct_2", cutover_at: null },
  };
  const mock = buildMock({ user: ADMIN, isAdmin: true, brands });

  const res1 = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [B1, B2], reason: "wave-2 batch" }),
    mock.deps,
  );
  assertEquals(res1.status, 200);
  const body1 = await res1.json();
  assertEquals(body1.counts.flipped, 2);
  assertEquals(mock.flipCalls.sort(), ["acct_1", "acct_2"]);
  assertEquals(
    mock.rpcCalls.filter((c) => c.name === "stamp_payout_hold_cutover").length,
    2,
  );
  assertEquals(
    mock.rpcCalls.filter((c) => c.name === "admin_write_audit").length,
    2,
  );

  // Re-run the SAME batch — brands now stamped → skip WITHOUT any Stripe call.
  const flipsBefore = mock.flipCalls.length;
  const res2 = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [B1, B2], reason: "wave-2 rerun" }),
    mock.deps,
  );
  assertEquals(res2.status, 200);
  const body2 = await res2.json();
  assertEquals(body2.counts.skipped_already_stamped, 2);
  assertEquals(body2.counts.flipped, 0);
  assertEquals(mock.flipCalls.length, flipsBefore); // ZERO new Stripe calls
});

Deno.test("hold: one brand's Stripe failure yields flip_failed without aborting the batch", async () => {
  const brands: Record<string, BrandState> = {
    [B1]: { stripe_account_id: "acct_1", cutover_at: null },
    [B2]: { stripe_account_id: "acct_2", cutover_at: null },
  };
  const mock = buildMock({
    user: ADMIN,
    isAdmin: true,
    brands,
    flipRejectAccounts: new Set(["acct_2"]),
  });
  const res = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [B1, B2], reason: "resilience" }),
    mock.deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.counts.flipped, 1);
  assertEquals(body.counts.flip_failed, 1);
  const b2 = body.results.find((r: { brand_id: string }) => r.brand_id === B2);
  assertEquals(b2.result, "flip_failed");
});

Deno.test("hold: stamp failure compensates via restoreDailyPayoutSchedule (never manual-but-unstamped)", async () => {
  const brands: Record<string, BrandState> = {
    [B1]: { stripe_account_id: "acct_1", cutover_at: null },
  };
  const mock = buildMock({
    user: ADMIN,
    isAdmin: true,
    brands,
    stampReject: true,
  });
  const res = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [B1], reason: "atomicity" }),
    mock.deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.counts.stamp_failed_rolled_back, 1);
  assertEquals(mock.flipCalls, ["acct_1"]);
  assertEquals(mock.restoreCalls, ["acct_1"]); // compensation fired
  assertEquals(brands[B1].cutover_at, null); // brand ends UNSTAMPED
});

Deno.test("rollback: restores daily + NULLs cutover idempotently", async () => {
  const brands: Record<string, BrandState> = {
    [B1]: { stripe_account_id: "acct_1", cutover_at: "2026-07-01T00:00:00Z" },
  };
  const mock = buildMock({ user: ADMIN, isAdmin: true, brands });
  const res = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [B1], reason: "rollback", direction: "rollback" }),
    mock.deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.counts.rolled_back, 1);
  assertEquals(mock.restoreCalls, ["acct_1"]);
  assertEquals(brands[B1].cutover_at, null);
});

Deno.test("skips brands with no connected account (no Stripe call)", async () => {
  const brands: Record<string, BrandState> = {
    [B1]: { stripe_account_id: null, cutover_at: null },
  };
  const mock = buildMock({ user: ADMIN, isAdmin: true, brands });
  const res = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [B1], reason: "no acct" }),
    mock.deps,
  );
  const body = await res.json();
  assertEquals(body.counts.skipped_no_account, 1);
  assertEquals(mock.flipCalls.length, 0);
});

Deno.test("dry_run mutates nothing and makes no Stripe call", async () => {
  const brands: Record<string, BrandState> = {
    [B1]: { stripe_account_id: "acct_1", cutover_at: null },
  };
  const mock = buildMock({ user: ADMIN, isAdmin: true, brands });
  const res = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [B1], reason: "dry", dry_run: true }),
    mock.deps,
  );
  const body = await res.json();
  assertEquals(body.dry_run, true);
  assertEquals(body.results[0].result, "flipped"); // would-be
  assertEquals(mock.flipCalls.length, 0);
  assertEquals(mock.inserts.length, 0);
  assertEquals(mock.rpcCalls.length, 0);
  assertEquals(brands[B1].cutover_at, null);
});

Deno.test("batch controls + authz: >50 → 400, non-admin → 403, no-JWT → 401", async () => {
  const brands: Record<string, BrandState> = {};
  // >50
  const tooMany = Array.from(
    { length: 51 },
    (_v, i) => `00000000-0000-0000-0000-0000000000${String(i).padStart(2, "0")}`,
  );
  const over = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: tooMany, reason: "too big" }),
    buildMock({ user: ADMIN, isAdmin: true, brands }).deps,
  );
  assertEquals(over.status, 400);
  assertEquals((await over.json()).error, "batch_too_large");

  // non-admin
  const nonAdmin = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [B1], reason: "x" }),
    buildMock({ user: ADMIN, isAdmin: false, brands }).deps,
  );
  assertEquals(nonAdmin.status, 403);

  // no JWT
  const noJwt = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [B1], reason: "x" }, ""),
    buildMock({ user: ADMIN, isAdmin: true, brands }).deps,
  );
  assertEquals(noJwt.status, 401);
});

Deno.test("reason is required", async () => {
  const mock = buildMock({ user: ADMIN, isAdmin: true, brands: {} });
  const res = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [B1], reason: "   " }),
    mock.deps,
  );
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "reason_required");
  assert(mock.flipCalls.length === 0);
});
