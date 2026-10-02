/**
 * #3645 PR8 — sweep wires waiting-for-bank surface + ops alert copy;
 * migrate list_residual returns residual brands with audit-record shape.
 *
 * Source / wiring assertions (no live DB). Fails-on-revert: deleting the
 * surface RPC call or waiting_for_bank alert copy makes these RED.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CUTOVER_MIGRATION_AUDIT_KEYS,
  handleAdminPayoutHoldMigrate,
  type MigrateDeps,
} from "../../admin-payout-hold-migrate/index.ts";

const SWEEP = new URL("../index.ts", import.meta.url);
const MIGRATE = new URL(
  "../../admin-payout-hold-migrate/index.ts",
  import.meta.url,
);

Deno.test("#3645 PR8: sweep calls surface_payout_releases_waiting_for_bank", async () => {
  const src = await Deno.readTextFile(SWEEP);
  assertStringIncludes(src, "surface_payout_releases_waiting_for_bank");
  assertStringIncludes(src, "waitingForBank");
  assertStringIncludes(src, "payout_release_waiting_for_bank");
  assertStringIncludes(src, 'case "waiting_for_bank"');
  assertStringIncludes(src, "ops.payout_release_waiting_for_bank");
  assertStringIncludes(src, "notifyWaitingForBank");
});

Deno.test("#3645 PR8: migrate exports cutover audit record keys", () => {
  assertEquals(CUTOVER_MIGRATION_AUDIT_KEYS.includes("batch_id"), true);
  assertEquals(CUTOVER_MIGRATION_AUDIT_KEYS.includes("brand_id"), true);
  assertEquals(CUTOVER_MIGRATION_AUDIT_KEYS.includes("result"), true);
  assertEquals(CUTOVER_MIGRATION_AUDIT_KEYS.includes("reason"), true);
  assertEquals(CUTOVER_MIGRATION_AUDIT_KEYS.includes("actor_uid"), true);
  assertEquals(CUTOVER_MIGRATION_AUDIT_KEYS.length, 13);
});

Deno.test("#3645 PR8: list_residual is read-only and returns audit shape", async () => {
  const residualBrand = {
    id: "36450000-0000-4000-8000-000000000099",
    name: "Legacy Split",
    slug: "legacy-split",
    payment_provider: "paystack",
    paystack_subaccount_code: "ACCT_legacy",
    payout_hold_cutover_at: null,
  };
  let brandsQueried = false;
  let anyInsert = false;
  let anyRpc = false;

  const client = {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: {
            user: { id: "admin-uid", email: "admin@mingla.app" },
          },
          error: null,
        }),
    },
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        not: () => builder,
        order: () => builder,
        limit: () => {
          if (table === "brands") {
            brandsQueried = true;
            return Promise.resolve({ data: [residualBrand], error: null });
          }
          return Promise.resolve({ data: [], error: null });
        },
        range: () => {
          if (table === "brands") {
            brandsQueried = true;
            return Promise.resolve({ data: [residualBrand], error: null });
          }
          return Promise.resolve({ data: [], error: null });
        },
        maybeSingle: () => {
          if (table === "admin_users") {
            return Promise.resolve({
              data: { id: "admin-1" },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        insert: () => {
          anyInsert = true;
          return Promise.resolve({ error: null });
        },
      };
      return builder;
    },
    rpc: () => {
      anyRpc = true;
      return Promise.resolve({ data: null, error: null });
    },
  };

  const deps: MigrateDeps = {
    env: () => "x",
    createAdmin: () => client as never,
    setManualPayoutSchedule: () => {
      throw new Error("stripe must not run on list_residual");
    },
    restoreDailyPayoutSchedule: () => {
      throw new Error("stripe must not run on list_residual");
    },
  };

  const res = await handleAdminPayoutHoldMigrate(
    new Request("http://local/admin-payout-hold-migrate", {
      method: "POST",
      headers: { authorization: "Bearer t", "content-type": "application/json" },
      body: JSON.stringify({ list_residual: true }),
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.list_residual, true);
  assertEquals(body.mutated, false);
  assertEquals(body.dry_run, true);
  assertEquals(body.count, 1);
  assertEquals(body.residuals[0].brand_id, residualBrand.id);
  assertEquals(body.residuals[0].legacy_split, true);
  assert(Array.isArray(body.audit_record_keys));
  for (const key of CUTOVER_MIGRATION_AUDIT_KEYS) {
    assert(
      body.audit_record_keys.includes(key),
      `missing audit key ${key}`,
    );
    assert(
      Object.prototype.hasOwnProperty.call(body.audit_record_preview, key),
      `preview missing ${key}`,
    );
  }
  assertStringIncludes(body.live_apply_gated, "Seth");
  assert(brandsQueried, "list_residual must query brands");
  assertEquals(anyInsert, false, "list_residual must not write ledger");
  assertEquals(anyRpc, false, "list_residual must not stamp");
});

Deno.test("#3645 PR8: migrate source documents live-apply gate", async () => {
  const src = await Deno.readTextFile(MIGRATE);
  assertStringIncludes(src, "list_residual");
  assertStringIncludes(src, "Seth");
  assertStringIncludes(src, "CUTOVER_MIGRATION_AUDIT_KEYS");
});
