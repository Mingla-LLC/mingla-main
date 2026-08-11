/**
 * #1807 TESTER ADVERSARIAL — admin-payout-hold-migrate.
 *
 * Independent harness, deliberately NOT a copy of issue_1807_paystack_lane.test.ts.
 * That suite proves the happy path of each lane. This one attacks the seams:
 * rail-resolution ambiguity, batch isolation under failure, the admin gate,
 * dry-run purity, reversibility, and the direction-vs-rail precedence in the
 * shared outer catch.
 *
 * The mock keeps a single ORDERED JOURNAL of every side effect (select, rpc,
 * insert, Stripe call). Most assertions here are ABSENCE assertions — proving a
 * mutation did NOT happen is what protects a real Nigerian business from being
 * moved onto a payout sweep that has never executed a transfer in production.
 *
 * Fails-on-revert: `git checkout origin/main -- supabase/functions/admin-payout-hold-migrate/index.ts`
 * and the Paystack-lane, rollback-rail, reversibility and outer-catch cases fail;
 * the admin-gate, validation and Stripe-control cases keep passing, which is
 * correct — they guard behaviour #1807 must not have changed.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleAdminPayoutHoldMigrate, type MigrateDeps } from "../index.ts";

const KNOWN_RESULTS = [
  "flipped",
  "skipped_already_stamped",
  "skipped_no_account",
  "flip_failed",
  "stamp_failed",
  "stamp_failed_rolled_back",
  "rolled_back",
  "rollback_failed",
] as const;

interface BrandFixture {
  /** stripe_connect_accounts.stripe_account_id, or null for no row. */
  stripe?: string | null;
  /** an ACTIVE brand_paystack_recipients row exists. */
  recipientActive?: boolean;
  /** an INACTIVE (is_active = false) recipient row exists. */
  recipientInactive?: boolean;
  cutover?: string | null;
}

interface Opts {
  user?: { id: string; email: string } | null;
  admin?: boolean;
  brands: Record<string, BrandFixture>;
  /** "<table>:<brandId>" reads that throw at transport level. */
  throwOnSelect?: Set<string>;
  /** brand ids whose stamp RPC returns a PostgREST-style { error }. */
  stampError?: Set<string>;
  /** brand ids whose rollback RPC returns a PostgREST-style { error }. */
  rollbackError?: Set<string>;
  /** brand id -> the value the stamp RPC returns in `data`. */
  stampReturns?: Record<string, string>;
  /** stripe account ids whose setManualPayoutSchedule throws. */
  flipThrow?: Set<string>;
  /** stripe account ids whose restoreDailyPayoutSchedule throws. */
  restoreThrow?: Set<string>;
}

function buildHarness(opts: Opts) {
  const journal: string[] = [];
  const ledger: Record<string, unknown>[] = [];
  const rpcs: { name: string; args: Record<string, unknown> }[] = [];
  const audits: Record<string, unknown>[] = [];

  const client = {
    auth: {
      getUser: (_t: string) => {
        journal.push("auth:getUser");
        return Promise.resolve(
          opts.user
            ? { data: { user: opts.user }, error: null }
            : { data: { user: null }, error: new Error("bad token") },
        );
      },
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
          const key = (eqs["brand_id"] ?? eqs["id"] ?? eqs["email"]) as string;
          journal.push(`select:${table}:${key}`);
          if (opts.throwOnSelect?.has(`${table}:${key}`)) {
            return Promise.reject(new Error(`transport failure on ${table}`));
          }
          if (table === "admin_users") {
            return Promise.resolve({
              data: opts.admin ? { id: "admin-row" } : null,
              error: null,
            });
          }
          const b = opts.brands[key];
          if (table === "stripe_connect_accounts") {
            return Promise.resolve({
              data: b?.stripe ? { stripe_account_id: b.stripe } : null,
              error: null,
            });
          }
          if (table === "brand_paystack_recipients") {
            // Reproduce PostgREST filtering: .eq("is_active", true) can only
            // ever see an ACTIVE row.
            const wantsActive = eqs["is_active"] === true;
            const visible = wantsActive
              ? (b?.recipientActive ?? false)
              : (b?.recipientInactive ?? false);
            return Promise.resolve({
              data: visible ? { id: `rcp-${key}` } : null,
              error: null,
            });
          }
          if (table === "brands") {
            return Promise.resolve({
              data: b ? { payout_hold_cutover_at: b.cutover ?? null } : null,
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        insert: (row: Record<string, unknown>) => {
          journal.push(`insert:${table}:${String(row.result)}`);
          ledger.push({ table, ...row });
          return Promise.resolve({ error: null });
        },
      };
      return builder;
    },
    rpc(name: string, args: Record<string, unknown>) {
      const brandId = (args.p_brand_id ?? args.p_entity_id) as string;
      journal.push(`rpc:${name}:${brandId}`);
      rpcs.push({ name, args });
      if (name === "stamp_payout_hold_cutover") {
        if (opts.stampError?.has(brandId)) {
          return Promise.resolve({ data: null, error: new Error("stamp boom") });
        }
        const b = opts.brands[brandId];
        if (b) b.cutover = "2026-08-10T12:00:00Z";
        return Promise.resolve({
          data: opts.stampReturns?.[brandId] ?? "flipped",
          error: null,
        });
      }
      if (name === "rollback_payout_hold_cutover") {
        if (opts.rollbackError?.has(brandId)) {
          return Promise.resolve({
            data: null,
            error: new Error("rollback boom"),
          });
        }
        const b = opts.brands[brandId];
        if (b) b.cutover = null;
        return Promise.resolve({ data: "rolled_back", error: null });
      }
      if (name === "admin_write_audit") {
        audits.push(args);
        return Promise.resolve({ data: "audit", error: null });
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
    setManualPayoutSchedule: (acct: string) => {
      journal.push(`stripe:setManual:${acct}`);
      if (opts.flipThrow?.has(acct)) throw new Error("stripe flip boom");
      return Promise.resolve({ id: acct });
    },
    restoreDailyPayoutSchedule: (acct: string) => {
      journal.push(`stripe:restoreDaily:${acct}`);
      if (opts.restoreThrow?.has(acct)) throw new Error("stripe restore boom");
      return Promise.resolve({ id: acct });
    },
  };

  return { deps, journal, ledger, rpcs, audits };
}

const ADMIN = { id: "admin-uid", email: "admin@usemingla.com" };
const NG = "d1807000-0000-4000-8000-00000000000a";
const NG2 = "d1807000-0000-4000-8000-00000000000b";
const US = "d1807000-0000-4000-8000-00000000000c";
const BOTH = "d1807000-0000-4000-8000-00000000000d";
const NONE = "d1807000-0000-4000-8000-00000000000e";

function post(body: unknown, auth: string | null = "Bearer good"): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) headers.authorization = auth;
  return new Request("https://x.test/functions/v1/admin-payout-hold-migrate", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const stamps = (h: { journal: string[] }) =>
  h.journal.filter((e) => e.startsWith("rpc:stamp_payout_hold_cutover"));
const rollbacks = (h: { journal: string[] }) =>
  h.journal.filter((e) => e.startsWith("rpc:rollback_payout_hold_cutover"));
const stripeCalls = (h: { journal: string[] }) =>
  h.journal.filter((e) => e.startsWith("stripe:"));
const recipientReads = (h: { journal: string[] }) =>
  h.journal.filter((e) => e.startsWith("select:brand_paystack_recipients"));

// ── Rail resolution when BOTH rails exist ────────────────────────────────────
// The implementor's Stripe control fixture has no Paystack recipient, so the
// "Stripe wins" contract is never actually contended there. A brand holding both
// is exactly the migration case that would arise from a country change.

Deno.test("#1807 tester: a brand with BOTH a Stripe account and an ACTIVE Paystack recipient takes the Stripe lane, and the recipient is never even read", async () => {
  const h = buildHarness({
    user: ADMIN,
    admin: true,
    brands: {
      [BOTH]: { stripe: "acct_both", recipientActive: true, cutover: null },
    },
  });
  const body = await (await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [BOTH], reason: "both rails" }),
    h.deps,
  )).json();

  assertEquals(body.counts.flipped, 1);
  assertEquals(recipientReads(h).length, 0);
  assertEquals(stripeCalls(h), ["stripe:setManual:acct_both"]);
  assertEquals(h.rpcs[0].args.p_stripe_account_id, "acct_both");
});

Deno.test("#1807 tester: BOTH rails on a ROLLBACK stays on Stripe — daily is restored and the recipient is never read", async () => {
  const h = buildHarness({
    user: ADMIN,
    admin: true,
    brands: {
      [BOTH]: {
        stripe: "acct_both",
        recipientActive: true,
        cutover: "2026-08-01T00:00:00Z",
      },
    },
  });
  const body = await (await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [BOTH], reason: "both rollback", direction: "rollback" }),
    h.deps,
  )).json();

  assertEquals(body.counts.rolled_back, 1);
  assertEquals(recipientReads(h).length, 0);
  assertEquals(stripeCalls(h), ["stripe:restoreDaily:acct_both"]);
  assertEquals(
    h.rpcs.find((r) => r.name === "rollback_payout_hold_cutover")!.args
      .p_stripe_account_id,
    "acct_both",
  );
});

Deno.test("#1807 tester: an INACTIVE recipient is not a rail on the ROLLBACK direction either", async () => {
  const h = buildHarness({
    user: ADMIN,
    admin: true,
    brands: {
      [NONE]: {
        stripe: null,
        recipientInactive: true,
        cutover: "2026-08-01T00:00:00Z",
      },
    },
  });
  const body = await (await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [NONE], reason: "inactive rollback", direction: "rollback" }),
    h.deps,
  )).json();

  assertEquals(body.counts.skipped_no_account, 1);
  assertEquals(body.counts.rolled_back, 0);
  assertEquals(rollbacks(h).length, 0);
  assertEquals(stripeCalls(h).length, 0);
});

// ── Idempotency under retry ─────────────────────────────────────────────────

Deno.test("#1807 tester: the SAME brand twice in ONE batch is stamped exactly once — never a double flip", async () => {
  const h = buildHarness({
    user: ADMIN,
    admin: true,
    brands: { [NG]: { stripe: null, recipientActive: true, cutover: null } },
  });
  const body = await (await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [NG, NG], reason: "duplicate ids" }),
    h.deps,
  )).json();

  assertEquals(stamps(h).length, 1, "the brand must be stamped exactly once");
  assertEquals(body.counts.flipped, 1);
  assertEquals(body.counts.skipped_already_stamped, 1);
  assertEquals(body.results.length, 2);
});

Deno.test("#1807 tester: re-running a whole batch after it succeeded mutates nothing further", async () => {
  const brands = {
    [NG]: { stripe: null, recipientActive: true, cutover: null },
    [US]: { stripe: "acct_us", recipientActive: false, cutover: null },
  };
  const h = buildHarness({ user: ADMIN, admin: true, brands });
  await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [NG, US], reason: "first run" }),
    h.deps,
  );
  const stampsAfterFirst = stamps(h).length;
  const stripeAfterFirst = stripeCalls(h).length;

  const body = await (await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [NG, US], reason: "retry" }),
    h.deps,
  )).json();

  assertEquals(body.counts.skipped_already_stamped, 2);
  assertEquals(body.counts.flipped, 0);
  assertEquals(stamps(h).length, stampsAfterFirst, "no re-stamp on retry");
  assertEquals(
    stripeCalls(h).length,
    stripeAfterFirst,
    "an already-stamped Stripe brand must not be flipped again",
  );
});

// ── Batch isolation under failure ───────────────────────────────────────────

Deno.test("#1807 tester: a Paystack stamp failure in the MIDDLE of a batch does not abort or corrupt the brands around it", async () => {
  const h = buildHarness({
    user: ADMIN,
    admin: true,
    brands: {
      [NG]: { stripe: null, recipientActive: true, cutover: null },
      [NG2]: { stripe: null, recipientActive: true, cutover: null },
      [US]: { stripe: "acct_us", recipientActive: false, cutover: null },
      [NONE]: { stripe: null, cutover: null },
    },
    stampError: new Set([NG2]),
  });
  const body = await (await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [NG, NG2, US, NONE], reason: "isolation" }),
    h.deps,
  )).json();

  assertEquals(body.results.length, 4, "every brand must be reported");
  assertEquals(body.counts.flipped, 2); // NG + US
  assertEquals(body.counts.stamp_failed, 1); // NG2
  assertEquals(body.counts.skipped_no_account, 1); // NONE
  assertEquals(body.counts.flip_failed, 0);
  assertEquals(body.counts.stamp_failed_rolled_back, 0);

  // The failing brand must not have dragged the Stripe brand's compensation in.
  assertEquals(stripeCalls(h), ["stripe:setManual:acct_us"]);
  // And the failure's own ledger row is the truthful one.
  const failRow = h.ledger.find((r) => r.result === "stamp_failed")!;
  assertEquals(failRow.brand_id, NG2);
  assertEquals(failRow.stripe_account_id, null);
  assertEquals(failRow.prior_interval, null);
  assertEquals(failRow.new_interval, null);
});

Deno.test("#1807 tester: a STRIPE flip failure does not stop the Paystack brand queued behind it", async () => {
  const h = buildHarness({
    user: ADMIN,
    admin: true,
    brands: {
      [US]: { stripe: "acct_bad", recipientActive: false, cutover: null },
      [NG]: { stripe: null, recipientActive: true, cutover: null },
    },
    flipThrow: new Set(["acct_bad"]),
  });
  const body = await (await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [US, NG], reason: "stripe fails first" }),
    h.deps,
  )).json();

  assertEquals(body.counts.flip_failed, 1);
  assertEquals(body.counts.flipped, 1);
  assertEquals(body.counts.stamp_failed, 0);
  assertEquals(stamps(h).length, 1, "only the Paystack brand reached a stamp");
  // The Stripe brand's flip_failed row keeps its Stripe shape.
  const flipRow = h.ledger.find((r) => r.result === "flip_failed")!;
  assertEquals(flipRow.stripe_account_id, "acct_bad");
  assertEquals(flipRow.prior_interval, "daily");
  assertEquals(flipRow.new_interval, "daily");
});

Deno.test("#1807 tester: a STRIPE stamp failure still compensates and still records stamp_failed_rolled_back", async () => {
  const h = buildHarness({
    user: ADMIN,
    admin: true,
    brands: {
      [US]: { stripe: "acct_us", recipientActive: false, cutover: null },
    },
    stampError: new Set([US]),
  });
  const body = await (await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [US], reason: "stripe stamp fails" }),
    h.deps,
  )).json();

  assertEquals(body.counts.stamp_failed_rolled_back, 1);
  assertEquals(
    body.counts.stamp_failed,
    0,
    "the #1807 value must NEVER be reachable from the Stripe lane",
  );
  assertEquals(stripeCalls(h), [
    "stripe:setManual:acct_us",
    "stripe:restoreDaily:acct_us",
  ]);
});

// ── direction vs rail precedence in the shared outer catch ──────────────────

Deno.test("#1807 tester: a Paystack ROLLBACK failure records rollback_failed, never stamp_failed", async () => {
  const h = buildHarness({
    user: ADMIN,
    admin: true,
    brands: {
      [NG]: {
        stripe: null,
        recipientActive: true,
        cutover: "2026-08-01T00:00:00Z",
      },
    },
    rollbackError: new Set([NG]),
  });
  const body = await (await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [NG], reason: "ng rollback fails", direction: "rollback" }),
    h.deps,
  )).json();

  assertEquals(body.counts.rollback_failed, 1);
  assertEquals(body.counts.stamp_failed, 0);
  assertEquals(stripeCalls(h).length, 0);
  const row = h.ledger.find((r) => r.result === "rollback_failed")!;
  assertEquals(row.stripe_account_id, null);
  assertEquals(row.prior_interval, null);
  assertEquals(row.new_interval, null);
});

Deno.test("#1807 tester: an UNEXPECTED error on a Paystack ROLLBACK records rollback_failed — direction beats rail", async () => {
  const h = buildHarness({
    user: ADMIN,
    admin: true,
    brands: {
      [NG]: {
        stripe: null,
        recipientActive: true,
        cutover: "2026-08-01T00:00:00Z",
      },
    },
    throwOnSelect: new Set([`brands:${NG}`]),
  });
  const body = await (await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [NG], reason: "unexpected rollback", direction: "rollback" }),
    h.deps,
  )).json();

  assertEquals(body.counts.rollback_failed, 1);
  assertEquals(body.counts.stamp_failed, 0);
  assertEquals(body.counts.flip_failed, 0);
});

Deno.test("#1807 tester: when account resolution ITSELF throws, the rail was never known and the row is flip_failed — the documented residual, pinned", async () => {
  const h = buildHarness({
    user: ADMIN,
    admin: true,
    brands: { [NG]: { stripe: null, recipientActive: true, cutover: null } },
    throwOnSelect: new Set([`stripe_connect_accounts:${NG}`]),
  });
  const body = await (await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [NG], reason: "resolution throws" }),
    h.deps,
  )).json();

  // Documented in index.ts: paystackLane is false because no rail was resolved,
  // so a Paystack-only brand CAN still produce flip_failed by this one route.
  assertEquals(body.counts.flip_failed, 1);
  assertEquals(body.counts.stamp_failed, 0);
  assertEquals(recipientReads(h).length, 0);
  assertEquals(stamps(h).length, 0);
});

Deno.test("#1807 tester: a STRIPE brand whose resolution throws still records flip_failed — unchanged from #1173", async () => {
  const h = buildHarness({
    user: ADMIN,
    admin: true,
    brands: { [US]: { stripe: "acct_us", cutover: null } },
    throwOnSelect: new Set([`stripe_connect_accounts:${US}`]),
  });
  const body = await (await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [US], reason: "stripe resolution throws" }),
    h.deps,
  )).json();
  assertEquals(body.counts.flip_failed, 1);
  assertEquals(body.counts.stamp_failed, 0);
  assertEquals(stripeCalls(h).length, 0);
});

// ── Reversibility through the edge function ─────────────────────────────────

Deno.test("#1807 tester: a Paystack brand can be stamped, rolled back, and stamped AGAIN through the fn", async () => {
  const brands = { [NG]: { stripe: null, recipientActive: true, cutover: null } };
  const h = buildHarness({ user: ADMIN, admin: true, brands });

  const first = await (await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [NG], reason: "stamp" }),
    h.deps,
  )).json();
  assertEquals(first.counts.flipped, 1);
  assert(brands[NG].cutover !== null);

  const back = await (await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [NG], reason: "undo", direction: "rollback" }),
    h.deps,
  )).json();
  assertEquals(back.counts.rolled_back, 1);
  assertEquals(brands[NG].cutover, null, "ONE-WAY TRAP: rollback did not clear the stamp");

  const again = await (await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [NG], reason: "re-stamp" }),
    h.deps,
  )).json();
  assertEquals(again.counts.flipped, 1);
  assertEquals(again.counts.skipped_already_stamped, 0);
  assertEquals(stamps(h).length, 2);
  assertEquals(stripeCalls(h).length, 0, "no Stripe call anywhere on this rail");
});

// ── dry_run purity ──────────────────────────────────────────────────────────

Deno.test("#1807 tester: dry_run ROLLBACK on the Paystack lane mutates NOTHING", async () => {
  const brands = {
    [NG]: {
      stripe: null,
      recipientActive: true,
      cutover: "2026-08-01T00:00:00Z",
    },
  };
  const h = buildHarness({ user: ADMIN, admin: true, brands });
  const body = await (await handleAdminPayoutHoldMigrate(
    post({
      brand_ids: [NG],
      reason: "dry rollback",
      direction: "rollback",
      dry_run: true,
    }),
    h.deps,
  )).json();

  assertEquals(body.dry_run, true);
  assertEquals(body.results[0].result, "rolled_back");
  assertEquals(h.ledger.length, 0);
  assertEquals(h.rpcs.length, 0);
  assertEquals(stripeCalls(h).length, 0);
  assertEquals(brands[NG].cutover, "2026-08-01T00:00:00Z");
});

Deno.test("#1807 tester: dry_run over a MIXED batch writes no ledger row, calls no RPC and touches no Stripe account", async () => {
  const brands = {
    [NG]: { stripe: null, recipientActive: true, cutover: null },
    [US]: { stripe: "acct_us", cutover: null },
    [BOTH]: { stripe: "acct_both", recipientActive: true, cutover: null },
    [NONE]: { stripe: null, cutover: null },
  };
  const h = buildHarness({ user: ADMIN, admin: true, brands });
  const body = await (await handleAdminPayoutHoldMigrate(
    post({
      brand_ids: [NG, US, BOTH, NONE],
      reason: "dry mixed",
      dry_run: true,
    }),
    h.deps,
  )).json();

  assertEquals(body.counts.flipped, 3);
  assertEquals(body.counts.skipped_no_account, 1);
  assertEquals(h.ledger.length, 0, "dry_run wrote to the append-only ledger");
  assertEquals(h.rpcs.length, 0, "dry_run called an RPC");
  assertEquals(stripeCalls(h).length, 0, "dry_run touched Stripe");
  for (const id of Object.keys(brands)) {
    assertEquals(brands[id].cutover ?? null, null);
  }
});

// ── The admin gate ──────────────────────────────────────────────────────────

Deno.test("#1807 tester: a NON-ADMIN authenticated caller gets 403 and performs zero rail resolution and zero mutation", async () => {
  const h = buildHarness({
    user: { id: "u2", email: "someone@example.test" },
    admin: false,
    brands: { [NG]: { stripe: null, recipientActive: true, cutover: null } },
  });
  const res = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [NG], reason: "not an admin" }),
    h.deps,
  );
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error, "forbidden");
  assertEquals(h.ledger.length, 0);
  assertEquals(h.rpcs.length, 0);
  assertEquals(stripeCalls(h).length, 0);
  assertEquals(recipientReads(h).length, 0);
  assertEquals(
    h.journal.filter((e) => e.startsWith("select:brands")).length,
    0,
    "a non-admin must not be able to probe brand payout state",
  );
});

Deno.test("#1807 tester: no authorization header is 401 before the service client resolves any rail", async () => {
  const h = buildHarness({
    user: ADMIN,
    admin: true,
    brands: { [NG]: { stripe: null, recipientActive: true, cutover: null } },
  });
  const res = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [NG], reason: "no auth" }, null),
    h.deps,
  );
  assertEquals(res.status, 401);
  assertEquals(h.journal.length, 0);
});

Deno.test("#1807 tester: an invalid token is 401 and never reaches the admin table or any rail", async () => {
  const h = buildHarness({
    user: null,
    admin: true,
    brands: { [NG]: { stripe: null, recipientActive: true, cutover: null } },
  });
  const res = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [NG], reason: "bad token" }, "Bearer nope"),
    h.deps,
  );
  assertEquals(res.status, 401);
  assertEquals(h.journal, ["auth:getUser"]);
  assertEquals(h.ledger.length, 0);
});

Deno.test("#1807 tester: GET is rejected outright", async () => {
  const h = buildHarness({ user: ADMIN, admin: true, brands: {} });
  const res = await handleAdminPayoutHoldMigrate(
    new Request("https://x.test/f", { method: "GET" }),
    h.deps,
  );
  assertEquals(res.status, 405);
  assertEquals(h.journal.length, 0);
});

// ── Request validation cannot be used to mutate ─────────────────────────────

Deno.test("#1807 tester: a reason made only of invisible whitespace is rejected with zero side effects", async () => {
  for (const reason of ["   ", "​​", "﻿ ", " "]) {
    const h = buildHarness({
      user: ADMIN,
      admin: true,
      brands: { [NG]: { stripe: null, recipientActive: true, cutover: null } },
    });
    const res = await handleAdminPayoutHoldMigrate(
      post({ brand_ids: [NG], reason }),
      h.deps,
    );
    assertEquals(res.status, 400, `reason ${JSON.stringify(reason)} was accepted`);
    assertEquals((await res.json()).error, "reason_required");
    assertEquals(h.journal.length, 0);
  }
});

Deno.test("#1807 tester: an oversized batch and a malformed uuid are both rejected before any read", async () => {
  const big = Array.from({ length: 51 }, (_, i) =>
    `d1807000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  let h = buildHarness({ user: ADMIN, admin: true, brands: {} });
  let res = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: big, reason: "too big" }),
    h.deps,
  );
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "batch_too_large");
  assertEquals(h.journal.length, 0);

  h = buildHarness({ user: ADMIN, admin: true, brands: {} });
  res = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [NG, "'; drop table brands; --"], reason: "bad uuid" }),
    h.deps,
  );
  assertEquals(res.status, 400);
  assertEquals((await res.json()).detail, "brand_id_invalid_uuid");
  assertEquals(h.journal.length, 0);

  h = buildHarness({ user: ADMIN, admin: true, brands: {} });
  res = await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [NG], reason: "bad direction", direction: "sideways" }),
    h.deps,
  );
  assertEquals(res.status, 400);
  assertEquals((await res.json()).detail, "direction_invalid");
  assertEquals(h.journal.length, 0);
});

// ── Counter shape ───────────────────────────────────────────────────────────

Deno.test("#1807 tester: every reported result is a known MigrateResult and no counter is ever NaN", async () => {
  const h = buildHarness({
    user: ADMIN,
    admin: true,
    brands: {
      [NG]: { stripe: null, recipientActive: true, cutover: null },
      [NG2]: { stripe: null, recipientActive: true, cutover: null },
      [US]: { stripe: "acct_us", cutover: null },
      [BOTH]: { stripe: "acct_bad", recipientActive: true, cutover: null },
      [NONE]: { stripe: null, cutover: null },
    },
    stampError: new Set([NG2]),
    flipThrow: new Set(["acct_bad"]),
  });
  const body = await (await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [NG, NG2, US, BOTH, NONE], reason: "counter shape" }),
    h.deps,
  )).json();

  assertEquals(Object.keys(body.counts).sort(), [...KNOWN_RESULTS].sort());
  let total = 0;
  for (const [k, v] of Object.entries(body.counts)) {
    assert(Number.isInteger(v as number), `counts.${k} is not an integer: ${v}`);
    total += v as number;
  }
  assertEquals(total, 5, "counts must sum to the number of brands submitted");
  for (const r of body.results) {
    assert(
      (KNOWN_RESULTS as readonly string[]).includes(r.result),
      `unknown result reached the response: ${r.result}`,
    );
  }
  // Every ledger row the fn writes directly must carry a CHECK-legal result.
  for (const row of h.ledger) {
    assert(
      (KNOWN_RESULTS as readonly string[]).includes(row.result as string),
      `ledger row carries a result the CHECK would reject: ${row.result}`,
    );
  }
});

// ── Known gap, pinned so a fix is deliberate ────────────────────────────────

Deno.test("#1807 tester: KNOWN GAP — the stamp RPC's return value is discarded, so a concurrency loser is still reported flipped", async () => {
  // The DB is the source of truth and it is correct: the RPC itself returns
  // 'skipped_already_stamped' and writes a truthful skip row (proved at SQL
  // level in issue_1807_paystack_ledger_truth.tester_adversarial.test.sql A1).
  // The edge fn, on both rails since #1173, ignores that return value and
  // reports 'flipped' to the admin and to admin_write_audit. No money moves on
  // this and the cutover ledger stays correct, so it is pinned rather than
  // failed. If this assertion ever fires, the return value is now honoured —
  // delete this test, do not weaken it.
  const h = buildHarness({
    user: ADMIN,
    admin: true,
    brands: { [NG]: { stripe: null, recipientActive: true, cutover: null } },
    stampReturns: { [NG]: "skipped_already_stamped" },
  });
  const body = await (await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [NG], reason: "race loser" }),
    h.deps,
  )).json();

  assertEquals(body.counts.flipped, 1);
  assertEquals(body.counts.skipped_already_stamped, 0);
  const audit = h.audits.find((a) =>
    (a.p_metadata as Record<string, unknown>).result === "flipped"
  );
  assert(audit, "the second audit trail records flipped for a call that skipped");
});

// ── The Stripe lane is untouched, asserted as a whole-journal shape ──────────

Deno.test("#1807 tester: a pure Stripe hold produces the EXACT #1173 side-effect sequence, with no #1807 read inserted anywhere", async () => {
  const h = buildHarness({
    user: ADMIN,
    admin: true,
    brands: { [US]: { stripe: "acct_us", cutover: null } },
  });
  await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [US], reason: "journal shape" }),
    h.deps,
  );
  assertEquals(h.journal, [
    "auth:getUser",
    `select:admin_users:${ADMIN.email}`,
    `select:stripe_connect_accounts:${US}`,
    `select:brands:${US}`,
    "stripe:setManual:acct_us",
    `rpc:stamp_payout_hold_cutover:${US}`,
    `rpc:admin_write_audit:${US}`,
  ]);
});

Deno.test("#1807 tester: a pure Stripe ROLLBACK produces the EXACT #1173 side-effect sequence", async () => {
  const h = buildHarness({
    user: ADMIN,
    admin: true,
    brands: { [US]: { stripe: "acct_us", cutover: "2026-08-01T00:00:00Z" } },
  });
  await handleAdminPayoutHoldMigrate(
    post({ brand_ids: [US], reason: "journal shape", direction: "rollback" }),
    h.deps,
  );
  assertEquals(h.journal, [
    "auth:getUser",
    `select:admin_users:${ADMIN.email}`,
    `select:stripe_connect_accounts:${US}`,
    `select:brands:${US}`,
    "stripe:restoreDaily:acct_us",
    `rpc:rollback_payout_hold_cutover:${US}`,
    `rpc:admin_write_audit:${US}`,
  ]);
});
