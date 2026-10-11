/**
 * #3660 rework — implementor suite for the two findings of the independent
 * tester's report that live in the edge module.
 *
 * F-3  Explorer side: when the surviving-profile probe errors AFTER the login
 *      was removed, the result is still "deleted" (what `origin/main` answered).
 *      A first cut of #3660 threw there, so a user whose login was already gone
 *      was told the deletion failed.
 *
 * F-5  If the first response was lost after the database committed, the Stripe
 *      account and Paystack subaccount were never deactivated at the provider.
 *      The database now returns the provider targets again on a retry
 *      (`already_deleted: true` WITH lists); the module must act on them.
 *
 * Hermetic: a recording client stands in for the service-role Supabase client
 * and the real module is executed.
 *
 * FAILS-ON-REVERT:
 *   - throw on the surviving-profile probe error again            → F-3 fails
 *   - skip the provider step when the answer says already_deleted → F-5 fails
 *
 * Run: deno test --allow-read --allow-env --allow-net --no-check supabase/functions/_shared/__tests__/issue_3660_rework.implementor.test.ts
 */

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  deleteAuthUserIfReady,
  runBusinessSideDeletion,
} from "../accountDeletionSides.ts";

const UID = "00000000-0000-4000-8000-000000003663";
const BRAND = "00000000-0000-4000-8000-0000000036b3";

/** A client whose `profiles` probe answers what the spec says, and records calls. */
function profilesClient(spec: {
  probe: { data: unknown; error: { message: string } | null };
  deleteError?: string;
}) {
  const log: string[] = [];
  const from = (table: string) => {
    let op = "select";
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.delete = () => {
      op = "delete";
      return b;
    };
    b.maybeSingle = () => {
      log.push(`${table}:probe`);
      return Promise.resolve(spec.probe);
    };
    // deno-lint-ignore no-explicit-any
    b.then = (resolve: (v: any) => unknown) => {
      log.push(`${table}:${op}`);
      return Promise.resolve({
        error: spec.deleteError ? { message: spec.deleteError } : null,
      }).then(resolve);
    };
    return b;
  };
  // deno-lint-ignore no-explicit-any
  return { client: { from } as any, log };
}

const removable = {
  decide: () => Promise.resolve({ remove: true, reason: null }),
};

// ── F-3 ──────────────────────────────────────────────────────────────────────

for (const side of ["explorer", "business"] as const) {
  Deno.test(`#3660 F-3 · side=${side}: a failed surviving-profile probe after the login is gone still reports the deletion`, async () => {
    const { client, log } = profilesClient({
      probe: { data: null, error: { message: "simulated profiles outage" } },
    });
    let loginRemoved = 0;

    const result = await deleteAuthUserIfReady(client, UID, side, {
      ...removable,
      deleteUser: () => {
        loginRemoved += 1;
        return Promise.resolve({ error: null });
      },
    });

    assertEquals(loginRemoved, 1);
    assertEquals(result, { authDeleted: true, authRetained: false, retainedReason: null });
    // The probe was really attempted, and nothing was deleted blind.
    assertEquals(log, ["profiles:probe"]);
  });
}

Deno.test("#3660 F-3 · explorer side: the paths that threw BEFORE #3660 still throw", async () => {
  // (a) auth.admin.deleteUser fails → nothing was removed → throw.
  const a = profilesClient({ probe: { data: null, error: null } });
  await assertRejects(
    () =>
      deleteAuthUserIfReady(a.client, UID, "explorer", {
        ...removable,
        deleteUser: () => Promise.resolve({ error: { message: "nope" } }),
      }),
    Error,
    "Failed to delete account. Please try again.",
  );

  // (b) the profile survived and could not be deleted → "partially deleted".
  const b = profilesClient({
    probe: { data: { id: UID }, error: null },
    deleteError: "permission denied",
  });
  await assertRejects(
    () =>
      deleteAuthUserIfReady(b.client, UID, "explorer", {
        ...removable,
        deleteUser: () => Promise.resolve({ error: null }),
      }),
    Error,
    "Account partially deleted. Please contact support to complete removal.",
  );
  assertEquals(b.log, ["profiles:probe", "profiles:delete"]);
});

Deno.test("#3660 F-3 · explorer side: a surviving profile is still cleaned up when the probe works", async () => {
  const { client, log } = profilesClient({ probe: { data: { id: UID }, error: null } });
  const result = await deleteAuthUserIfReady(client, UID, "explorer", {
    ...removable,
    deleteUser: () => Promise.resolve({ error: null }),
  });
  assertEquals(result.authDeleted, true);
  assertEquals(log, ["profiles:probe", "profiles:delete"]);
});

// ── F-5 ──────────────────────────────────────────────────────────────────────

Deno.test("#3660 F-5 · a retry whose answer carries provider targets re-runs Stripe and Paystack", async () => {
  // What the database returns for the SECOND call after a lost first response.
  const retryAnswer = {
    status: "deleted",
    already_deleted: true,
    brand_ids: [],
    events_taken_down: 0,
    memberships_removed: 0,
    partner_links_ended: 0,
    stripe_accounts: [{ brand_id: BRAND, stripe_account_id: "acct_i3660r_retry" }],
    paystack_subaccounts: [{ brand_id: BRAND, subaccount_code: "ACCT_i3660r_retry" }],
  };
  const calls: string[] = [];
  const inserts: Array<Record<string, unknown>> = [];
  const client = {
    rpc: (name: string) => {
      calls.push(`rpc:${name}`);
      return Promise.resolve({ data: retryAnswer, error: null });
    },
    from: (_table: string) => ({
      insert: (row: Record<string, unknown>) => {
        inserts.push(row);
        return Promise.resolve({ error: null });
      },
    }),
    // deno-lint-ignore no-explicit-any
  } as any;

  const outcome = await runBusinessSideDeletion(client, UID, {
    stripeClient: () => ({
      accounts: {
        del: (id: string, o: { idempotencyKey: string }) => {
          calls.push(`stripe:${id}`);
          assert(o.idempotencyKey.length > 0);
          return Promise.resolve({});
        },
      },
    }),
    paystackDeactivate: (code: string) => {
      calls.push(`paystack:${code}`);
      return Promise.resolve({});
    },
    decide: () =>
      Promise.resolve({ remove: false, reason: "business_records_retained" as const }),
  });

  assertEquals(outcome.kind, "done");
  assertEquals(calls, [
    "rpc:biz_delete_host_account",
    "stripe:acct_i3660r_retry",
    "paystack:ACCT_i3660r_retry",
  ]);
  assertEquals(inserts, [], "a clean provider retry writes no failure audit row");
  assert(outcome.kind === "done");
  assertEquals(outcome.purge.already_deleted, true);
});
